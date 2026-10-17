/* EvalMetricTile — shared KPI tile for the eval views (Evals tab, agent eval
   page, Compare modal): label, big value, signed delta in points, optional
   sparkline. `null` values render "—". */
"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { Sparkline } from "@devdigest/ui";
import { pct, deltaPts } from "@/lib/eval-format";

export interface EvalMetricTileProps {
  label: string;
  /** Fraction 0..1, or null when not computed. */
  value: number | null | undefined;
  /** Previous value (fraction) the delta is computed against. */
  previous?: number | null;
  /** Overrides the formatted value (e.g. traces passed "3/4"). */
  valueText?: string;
  /** Overrides the formatted delta (e.g. a dollar delta). */
  deltaText?: string;
  /** Oldest → newest values for the sparkline. */
  spark?: number[];
  color?: string;
  /** Smaller, single-line value with the delta on its own row (old → new tiles). */
  compact?: boolean;
}

const tileStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 9,
  padding: 18,
};

function deltaColor(text: string): string {
  if (text.startsWith("+")) return "var(--ok)";
  if (text.startsWith("−")) return "var(--crit)";
  return "var(--text-muted)";
}

export function EvalMetricTile({
  label,
  value,
  previous,
  valueText,
  deltaText,
  spark,
  color = "var(--accent)",
  compact = false,
}: EvalMetricTileProps) {
  const t = useTranslations("eval");
  const shownValue = valueText ?? pct(value);
  const delta = deltaText ?? deltaPts(value, previous);
  // A single point cannot draw a line; repeat it so the sparkline stays defined.
  const points = spark && spark.length === 1 ? [spark[0]!, spark[0]!] : spark;
  const last = spark && spark.length > 0 ? spark[spark.length - 1] : null;

  return (
    <div style={tileStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.03em" }}
        >
          {label}
        </span>
        {points && points.length > 0 && (
          <span role="img" aria-label={t("metrics.trend", { label, value: pct(last) })}>
            <Sparkline data={points} color={color} w={56} h={20} />
          </span>
        )}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: compact ? "flex-start" : "baseline",
          flexDirection: compact ? "column" : "row",
          gap: compact ? 8 : 10,
          marginTop: 12,
        }}
      >
        <span
          className="tnum"
          style={{
            fontSize: compact ? 22 : 32,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            whiteSpace: compact ? "nowrap" : undefined,
          }}
        >
          {shownValue}
        </span>
        <span
          className="tnum"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: deltaColor(delta),
            ...(compact
              ? { padding: "2px 8px", borderRadius: 99, background: "var(--bg-hover)" }
              : null),
          }}
        >
          {delta}
        </span>
      </div>
    </div>
  );
}
