/* MultiAgentResultsView — results of the latest multi-agent run on a PR:
   header + meta, Columns/Tabs switch (URL-backed), disagreement block and the
   shared run-trace drawer. Polling lives in useMultiAgentRun. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState } from "@devdigest/ui";
import type { AgentColumn, ConflictTake } from "@devdigest/shared";
import RunTraceDrawer from "@/components/run-trace-drawer";
import { formatCost } from "@/lib/format-cost";
import { usePulls } from "@/lib/hooks";
import { useMultiAgentRun } from "@/lib/hooks/multi-agent";
import { usePrReviews } from "@/lib/hooks/reviews";
import { configureHref, resultsHref } from "@/lib/multi-agent";
import { useActiveRepo } from "@/lib/repo-context";
import { AgentColumns } from "./_components/AgentColumns";
import { AgentTabs } from "./_components/AgentTabs";
import { DisagreementBlock } from "./_components/DisagreementBlock";
import { findingsForRun, metaSeconds, parseMode, pickColumn, type ResultsMode } from "./helpers";
import { s } from "./styles";

interface DrawerState {
  runId: string;
  agentName: string | null;
}

export function MultiAgentResultsView({
  repoId,
  prNumber,
  prId,
}: {
  repoId: string;
  prNumber: number;
  /** uuid of the PR, or null while the PR list is still loading. */
  prId: string | null;
}) {
  const t = useTranslations("runs");
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { activeRepo } = useActiveRepo();
  const { data: pulls } = usePulls(repoId);
  const { data: run, isError } = useMultiAgentRun(prId);
  const { data: reviews } = usePrReviews(prId);
  const [drawer, setDrawer] = React.useState<DrawerState | null>(null);

  const mode = parseMode(search.get("view"));
  const runParam = search.get("run");
  const findingParam = search.get("finding");
  const pr = pulls?.find((p) => p.number === prNumber);

  // Tabs findings come from the reviews query: refresh it as columns finish.
  const doneCount = run?.columns.filter((c) => c.status === "done").length ?? 0;
  React.useEffect(() => {
    if (prId && doneCount > 0) qc.invalidateQueries({ queryKey: ["reviews", prId] });
  }, [doneCount, prId, qc]);

  const go = (extra: { view?: ResultsMode; run?: string; finding?: string }) =>
    router.replace(resultsHref(repoId, prNumber, extra));

  const setMode = (next: ResultsMode) =>
    go({
      view: next,
      run: runParam ?? undefined,
      finding: findingParam ?? undefined,
    });

  const openTake = (take: ConflictTake) =>
    go({ view: "tabs", run: take.run_id, finding: take.finding_ids[0] });

  const openTrace = (c: AgentColumn) =>
    setDrawer({
      runId: c.run_id,
      agentName: c.agent_name ?? t("column.deletedAgent"),
    });

  if (!prId || run === undefined) {
    return isError ? (
      <div style={s.root}>
        <span style={s.note}>{t("page.refreshFailed")}</span>
      </div>
    ) : null;
  }

  if (run === null) {
    return (
      <EmptyState
        icon="Users"
        title={t("page.noRun.title")}
        body={t("page.noRun.bodySelect")}
        cta={t("page.noRun.ctaConfigure")}
        onCta={() => router.push(configureHref(repoId, prNumber))}
      />
    );
  }

  const selected = pickColumn(run.columns, runParam);
  const running = run.status === "running";
  const meta = t("page.meta", {
    count: run.agent_count,
    duration: metaSeconds(run.total_duration_ms),
    cost: run.total_cost_usd == null ? t("stats.na") : formatCost(run.total_cost_usd),
  });

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div style={s.titleBlock}>
          <h1 style={s.h1}>{t("page.title")}</h1>
          <span style={s.sub}>
            {t("page.subtitle", { count: run.agent_count })} ·{" "}
            <span title={pr?.title}>
              #{prNumber}
              {pr ? ` · ${pr.title}` : ""}
            </span>
          </span>
          <span style={s.meta}>{meta}</span>
          {isError && <span style={s.note}>{t("page.refreshFailed")}</span>}
        </div>
        <div style={s.actions}>
          <div style={s.switchGroup} role="group" aria-label={t("page.title")}>
            {(["columns", "tabs"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                style={{ ...s.switchBtn, ...(mode === m ? s.switchBtnOn : null) }}
                onClick={() => setMode(m)}
              >
                {t(`page.view.${m}`)}
              </button>
            ))}
          </div>
          <Button kind="secondary" size="sm" onClick={() => router.push(configureHref(repoId, prNumber))}>
            {t("page.configureRun")}
          </Button>
        </div>
      </div>

      {mode === "tabs" ? (
        <AgentTabs
          columns={run.columns}
          selected={selected}
          onSelect={(id) => go({ view: "tabs", run: id })}
          reviews={reviews}
          prId={prId}
          repoFullName={activeRepo?.full_name}
          headSha={pr?.head_sha}
          findingId={findingParam}
          onViewTrace={openTrace}
        />
      ) : (
        <AgentColumns columns={run.columns} onViewTrace={openTrace} />
      )}

      <DisagreementBlock
        conflicts={run.conflicts}
        columnCount={run.columns.length}
        running={running}
        onOpenTake={openTake}
      />

      {drawer && (
        <RunTraceDrawer
          runId={drawer.runId}
          agentName={drawer.agentName}
          prNumber={prNumber}
          findings={findingsForRun(reviews, drawer.runId)}
          running={run.columns.find((c) => c.run_id === drawer.runId)?.status === "running"}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}
