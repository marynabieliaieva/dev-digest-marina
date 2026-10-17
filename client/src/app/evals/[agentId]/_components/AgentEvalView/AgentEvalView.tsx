/* AgentEvalView — one agent's eval page: regression banner, three metric tiles
   with sparklines, a trend chart, and the recent-runs table with a two-run
   Compare selection. */
"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Icon, LineChart, SectionLabel, SelectInput, Skeleton } from "@devdigest/ui";
import { deltaPts, pct, usd } from "@/lib/eval-format";
import { useAgents, useAgent } from "@/lib/hooks/agents";
import { useAgentEvalBatches, useAgentEvalDashboard, useRunAgentEvals } from "@/lib/hooks/evals";
import { RunEvalButton } from "@/components/run-eval-button";
import { EvalMetricTile } from "@/components/eval-metric-tile";
import { fmtDateTime, METRIC_COLORS, newestFirst } from "../../../helpers";
import { CompareModal } from "../CompareModal";
import { MAX_COMPARE, TABLE_ROWS, chartSeries, orderPair, pointLabel, sparkOf } from "./helpers";
import { s } from "./styles";

export function AgentEvalView({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const { data: agents } = useAgents();
  const { data: agent } = useAgent(agentId);
  const dashboard = useAgentEvalDashboard(agentId);
  const batchesQ = useAgentEvalBatches(agentId);
  const runAgent = useRunAgentEvals();
  const [selected, setSelected] = React.useState<string[]>([]);
  const [comparing, setComparing] = React.useState<{ base: string; head: string } | null>(null);

  const rows = React.useMemo(() => newestFirst(batchesQ.data ?? []).slice(0, TABLE_ROWS), [batchesQ.data]);

  if (dashboard.isError || batchesQ.isError) {
    return (
      <div style={s.page}>
        <ErrorState
          body=""
          onRetry={() => {
            dashboard.refetch();
            batchesQ.refetch();
          }}
        />
      </div>
    );
  }
  if (dashboard.isLoading || batchesQ.isLoading || !dashboard.data) {
    return (
      <div style={s.page}>
        <Skeleton height={240} />
      </div>
    );
  }

  const d = dashboard.data;
  const enoughRuns = d.trend.length >= 2;
  const cur = d.current;
  const tiles = [
    { label: t("metrics.recall"), value: cur?.recall ?? null, delta: d.delta.recall, key: "recall" as const, color: METRIC_COLORS.recall },
    { label: t("metrics.precision"), value: cur?.precision ?? null, delta: d.delta.precision, key: "precision" as const, color: METRIC_COLORS.precision },
    {
      label: t("metrics.citation"),
      value: cur?.citation_accuracy ?? null,
      delta: d.delta.citation_accuracy,
      key: "citation_accuracy" as const,
      color: METRIC_COLORS.citation,
    },
  ];
  const series = chartSeries(d.trend, {
    recall: t("metrics.recall"),
    precision: t("metrics.precision"),
    citation: t("metrics.citation"),
  });
  const firstPoint = d.trend.slice(-50)[0];
  const lastPoint = d.trend[d.trend.length - 1];

  const toggle = (id: string) =>
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : sel.length >= MAX_COMPARE ? sel : [...sel, id]));

  const openCompare = () => {
    const [a, b] = selected.map((id) => rows.find((r) => r.id === id)).filter((x) => !!x);
    if (!a || !b) return;
    const { base, head } = orderPair(a, b);
    setComparing({ base: base.id, head: head.id });
  };

  return (
    <div style={s.page}>
      <Link href="/evals" style={s.back}>
        {t("agentPage.back")}
      </Link>

      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>{agent?.name ?? ""}</h1>
          {agent && (
            <Badge color="var(--text-secondary)" mono>
              {agent.model}
            </Badge>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div aria-label={t("agentPage.selectorLabel")} style={{ minWidth: 200 }}>
            <SelectInput
              mono={false}
              value={agentId}
              onChange={(id) => router.push(`/evals/${id}`)}
              options={(agents ?? []).map((a) => ({ value: a.id, label: a.name }))}
            />
          </div>
          <RunEvalButton
            label={t("run.runEval")}
            runningBatchId={d.running_batch_id}
            onStart={() => runAgent.mutateAsync(agentId)}
          />
        </div>
      </div>

      {d.alert && (
        <div role="alert" style={s.banner}>
          <Icon.AlertTriangle size={16} style={{ color: "var(--warn)", flexShrink: 0 }} />
          <span>
            <strong>{t("agentPage.alertLabel")}: </strong>
            {d.alert}
          </span>
        </div>
      )}

      <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
        {tiles.map((tile) => (
          <EvalMetricTile
            key={tile.key}
            label={tile.label}
            value={tile.value}
            deltaText={enoughRuns ? deltaPts(tile.delta, 0) : "—"}
            spark={sparkOf(d.trend, tile.key)}
            color={tile.color}
          />
        ))}
      </div>

      {d.trend.length > 0 && (
        <div style={s.card}>
          <SectionLabel icon="Activity">{t("agentPage.trendTitle")}</SectionLabel>
          <LineChart series={series} w={1200} h={220} yMin={0} yMax={1} />
          {firstPoint && lastPoint && (
            <div style={s.xLabels}>
              <span>{pointLabel(firstPoint)}</span>
              {lastPoint !== firstPoint && <span>{pointLabel(lastPoint)}</span>}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "24px 0 12px" }}>
        <SectionLabel icon="History">{t("agentPage.runsTitle")}</SectionLabel>
        <Button kind="primary" icon="Layers" disabled={selected.length !== MAX_COMPARE} onClick={openCompare}>
          {t("agentPage.compare")}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>{t("agentPage.noRuns")}</p>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              {(["select", "ranAt", "version", "recall", "precision", "citation", "pass", "cost", "status"] as const).map(
                (c) => (
                  <th key={c} style={s.th}>
                    {t(`agentPage.columns.${c}`)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const done = b.status === "done";
              const checked = selected.includes(b.id);
              return (
                <tr key={b.id}>
                  <td style={s.td}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!done || (!checked && selected.length >= MAX_COMPARE)}
                      onChange={() => toggle(b.id)}
                      aria-label={t("agentPage.selectRun", {
                        version: b.agent_version,
                        date: fmtDateTime(b.started_at),
                      })}
                    />
                  </td>
                  <td className="mono" style={s.td}>
                    {fmtDateTime(b.started_at)}
                  </td>
                  <td className="mono" style={{ ...s.td, color: "var(--accent)" }}>
                    v{b.agent_version}
                  </td>
                  <td className="tnum" style={s.td}>
                    {pct(b.recall)}
                  </td>
                  <td className="tnum" style={s.td}>
                    {pct(b.precision)}
                  </td>
                  <td className="tnum" style={s.td}>
                    {pct(b.citation_accuracy)}
                  </td>
                  <td className="tnum" style={{ ...s.td, fontWeight: 600 }}>
                    {b.traces_passed ?? 0}/{b.traces_total ?? b.cases_total}
                  </td>
                  <td className="tnum" style={s.td}>
                    {usd(b.cost_usd)}
                  </td>
                  <td style={s.td}>
                    {b.status === "running" ? t("agentPage.running") : b.status === "failed" ? t("agentPage.failed") : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {comparing && <CompareModal base={comparing.base} head={comparing.head} onClose={() => setComparing(null)} />}
    </div>
  );
}
