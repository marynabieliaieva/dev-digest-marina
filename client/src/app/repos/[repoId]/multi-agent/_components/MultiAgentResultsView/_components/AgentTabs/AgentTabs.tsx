/* AgentTabs — one tab per agent column + a summary card and the agent's
   findings rendered with the shared FindingCard (accept / dismiss / eval case
   wired exactly as in FindingsPanel; Learn is shown disabled). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, CircularScore } from "@devdigest/ui";
import type { AgentColumn, ReviewRecord } from "@devdigest/shared";
import { FindingCard } from "@/components/finding-card";
import { formatCost } from "@/lib/format-cost";
import { useCreateEvalCase } from "@/lib/hooks/evals";
import { useFindingAction } from "@/lib/hooks/reviews";
import { durationLabel, reviewForRun } from "../../helpers";
import { s } from "./styles";

export function AgentTabs({
  columns,
  selected,
  onSelect,
  reviews,
  prId,
  repoFullName,
  headSha,
  findingId,
  onViewTrace,
}: {
  columns: AgentColumn[];
  selected: AgentColumn | null;
  onSelect: (runId: string) => void;
  reviews: ReviewRecord[] | undefined;
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Finding to render expanded (from a disagreement take). */
  findingId: string | null;
  onViewTrace: (column: AgentColumn) => void;
}) {
  const t = useTranslations("runs");
  const action = useFindingAction();
  const createEvalCase = useCreateEvalCase();

  const review = selected ? reviewForRun(reviews, selected.run_id) : undefined;
  const findings = selected?.status === "done" ? (review?.findings ?? []) : [];
  const nameOf = (c: AgentColumn) => c.agent_name ?? t("column.deletedAgent");

  return (
    <div style={s.root}>
      <div style={s.tablist} role="tablist">
        {columns.map((c) => {
          const on = c.run_id === selected?.run_id;
          const suffix = c.status === "done" && c.score != null ? String(c.score) : t(`column.status.${c.status}`);
          return (
            <button
              key={c.run_id}
              type="button"
              role="tab"
              aria-selected={on}
              style={{ ...s.tab, ...(on ? s.tabOn : null) }}
              onClick={() => onSelect(c.run_id)}
              title={nameOf(c)}
            >
              <span style={s.tabName}>{nameOf(c)}</span>
              <span>{suffix}</span>
            </button>
          );
        })}
      </div>

      {selected && (
        <>
          <div style={s.summary}>
            {selected.status === "done" && selected.score != null && (
              <CircularScore score={selected.score} size={48} />
            )}
            <div style={s.summaryBody}>
              <span style={s.verdict}>
                {nameOf(selected)} · {selected.verdict ?? t(`column.status.${selected.status}`)}
              </span>
              {selected.status === "done" && (
                <span style={s.summaryText}>{selected.summary ?? t("tabs.noSummary")}</span>
              )}
              {selected.status === "failed" && selected.error && (
                <span style={s.error}>{selected.error}</span>
              )}
              <div style={s.stats}>
                {durationLabel(selected.duration_ms) && <span>{durationLabel(selected.duration_ms)}</span>}
                {selected.status === "done" && <span>{formatCost(selected.cost_usd)}</span>}
              </div>
            </div>
            <Button kind="ghost" size="sm" onClick={() => onViewTrace(selected)}>
              {t("viewTrace")}
            </Button>
          </div>

          {selected.status === "done" &&
            (findings.length === 0 ? (
              <span style={s.muted}>{t("column.noFindings")}</span>
            ) : (
              <div style={s.list}>
                {findings.map((f) => (
                  <FindingCard
                    key={`${f.id}:${findingId ?? ""}`}
                    f={f}
                    showLearn
                    defaultExpanded={f.id === findingId}
                    pending={action.isPending}
                    repoFullName={repoFullName}
                    headSha={headSha}
                    onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
                    agentName={review?.agent_name ?? selected.agent_name}
                    onCreateEvalCase={() =>
                      createEvalCase.mutateAsync({
                        findingId: f.id,
                        prId,
                        agentId: review?.agent_id ?? selected.agent_id ?? undefined,
                      })
                    }
                  />
                ))}
              </div>
            ))}
        </>
      )}
    </div>
  );
}
