/* Pure helpers for AgentEvalView. */
import type { ChartSeries } from "@devdigest/ui";
import type { EvalBatch, EvalTrendPoint } from "@devdigest/shared";
import { METRIC_COLORS, fmtDateTime } from "../../../helpers";

export const SPARK_POINTS = 10;
export const CHART_POINTS = 50;
export const TABLE_ROWS = 50;
export const MAX_COMPARE = 2;

/** Last `n` metric values of a trend (oldest → newest), skipping nulls. */
export function sparkOf(trend: EvalTrendPoint[], key: "recall" | "precision" | "citation_accuracy"): number[] {
  return trend
    .slice(-SPARK_POINTS)
    .map((p) => p[key])
    .filter((v): v is number => v != null);
}

/** Chart series over the last 50 trend points, in chronological order. */
export function chartSeries(
  trend: EvalTrendPoint[],
  names: { recall: string; precision: string; citation: string },
): ChartSeries[] {
  const pts = trend.slice(-CHART_POINTS);
  return [
    { name: names.recall, color: METRIC_COLORS.recall, data: pts.map((p) => p.recall ?? 0) },
    { name: names.precision, color: METRIC_COLORS.precision, data: pts.map((p) => p.precision ?? 0) },
    { name: names.citation, color: METRIC_COLORS.citation, data: pts.map((p) => p.citation_accuracy ?? 0) },
  ];
}

/** x-axis label of a trend point: "v<version> · <date>". */
export function pointLabel(p: EvalTrendPoint): string {
  return `v${p.agent_version} · ${fmtDateTime(p.ran_at).slice(0, 10)}`;
}

/** Orders two selected batches: older = base, newer = head. */
export function orderPair(a: EvalBatch, b: EvalBatch): { base: EvalBatch; head: EvalBatch } {
  return a.started_at <= b.started_at ? { base: a, head: b } : { base: b, head: a };
}
