/* AgentColumns — one result column per agent, in server (selection) order.
   `key={run_id}` keeps a column's DOM stable across polls. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, CircularScore, SeverityBadge } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";
import { formatCost } from "@/lib/format-cost";
import { durationLabel } from "../../helpers";
import { s } from "./styles";

export function AgentColumns({
  columns,
  onViewTrace,
}: {
  columns: AgentColumn[];
  onViewTrace: (column: AgentColumn) => void;
}) {
  const t = useTranslations("runs");

  return (
    <div style={{ ...s.grid, gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(0, 1fr))` }}>
      {columns.map((c) => {
        const name = c.agent_name ?? t("column.deletedAgent");
        const done = c.status === "done";
        const duration = durationLabel(c.duration_ms);
        return (
          <section key={c.run_id} style={s.col} aria-label={name}>
            <div style={s.head}>
              <span style={s.name} title={name}>
                {name}
              </span>
              <span style={s.status}>{t(`column.status.${c.status}`)}</span>
            </div>

            {done && (
              <>
                <div style={s.stats}>
                  {c.score != null && <CircularScore score={c.score} size={36} />}
                  {duration && <span>{duration}</span>}
                  <span>{formatCost(c.cost_usd)}</span>
                </div>
                <span style={s.count}>
                  {t("column.findingsCount", { count: c.findings_count ?? c.findings.length })}
                </span>
                {c.findings.length === 0 ? (
                  <span style={s.muted}>{t("column.noFindings")}</span>
                ) : (
                  <ul style={s.list}>
                    {c.findings.map((f) => (
                      <li key={f.id} style={s.item}>
                        <SeverityBadge severity={f.severity} compact />
                        <span style={s.itemTitle} title={f.title}>
                          {f.title}
                        </span>
                        <span style={s.itemLoc} title={`${f.file}:${f.start_line}`}>
                          {f.file}:{f.start_line}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {c.status === "failed" && c.error && <span style={s.error}>{c.error}</span>}

            <Button kind="ghost" size="sm" onClick={() => onViewTrace(c)}>
              {t("viewTrace")}
            </Button>
          </section>
        );
      })}
    </div>
  );
}
