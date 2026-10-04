/* BlastGraph — dependency-free SVG: symbol -> caller -> endpoint/cron. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
import { GRAPH_NODE_WIDTH, layoutBlastGraph, truncateLabel } from "./helpers";
import { s } from "./styles";

const NODE_H = 22;

const KIND_STROKE = {
  symbol: "var(--accent, var(--text-primary))",
  caller: "var(--border-strong)",
  endpoint: "var(--ok)",
  cron: "var(--text-muted)",
} as const;

export function BlastGraph({ blast }: { blast: BlastRadiusResponse["blast"] }) {
  const t = useTranslations("blast");
  const layout = React.useMemo(() => layoutBlastGraph(blast), [blast]);

  if (layout.nodes.length === 0) return <div style={s.muted}>{t("graph.empty")}</div>;

  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  return (
    <div style={s.svgWrap}>
      <svg
        role="img"
        aria-label={t("graph.ariaLabel")}
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
      >
        {layout.edges.map((e, i) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          return (
            <line
              key={`${i}-${e.from}-${e.to}`}
              x1={a.x + GRAPH_NODE_WIDTH}
              y1={a.y + NODE_H / 2}
              x2={b.x}
              y2={b.y + NODE_H / 2}
              stroke="var(--border-strong)"
              strokeWidth={1}
            />
          );
        })}
        {layout.nodes.map((n) => (
          <g key={n.id}>
            <rect
              x={n.x}
              y={n.y}
              width={GRAPH_NODE_WIDTH}
              height={NODE_H}
              rx={4}
              fill="var(--bg-elevated)"
              stroke={KIND_STROKE[n.kind]}
            />
            <text x={n.x + 8} y={n.y + 15} style={s.svgText}>
              {truncateLabel(n.label)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
