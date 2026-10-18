/* EvalDashboardView — workspace Eval Dashboard: one row per agent (last run,
   pass-rate sparkline, recall/precision/citation), the latest 20 runs across
   agents and a "Run all agents" action that follows each started batch. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge, BarRow, Button, ErrorState, Icon, SectionLabel, Skeleton, Sparkline } from "@devdigest/ui";
import type { AgentEvalSummary, EvalBatch } from "@devdigest/shared";
import { notify } from "@/lib/toast";
import { pct } from "@/lib/eval-format";
import { useEvalBatch, useEvalWorkspaceDashboard, useRunAllEvals } from "@/lib/hooks/evals";
import { fmtDateTime, METRIC_COLORS, newestFirst } from "../../helpers";
import { s } from "./styles";

const RECENT_LIMIT = 20;

/** Follows one started batch until it is terminal, then reports back. */
function BatchWatcher({ batchId, onDone }: { batchId: string; onDone: (id: string) => void }) {
  const { data, isError } = useEvalBatch(batchId);
  const status = data?.status;
  const finished = isError || (!!status && status !== "running");
  React.useEffect(() => {
    if (finished) onDone(batchId);
  }, [finished, batchId, onDone]);
  return null;
}

function AgentRow({ row, onOpen }: { row: AgentEvalSummary; onOpen: () => void }) {
  const t = useTranslations("eval.workspace");
  const last = row.last_batch;
  const summary =
    row.cases_total === 0
      ? t("noCases")
      : !last
        ? t("neverRun")
        : t("lastRun", {
            version: last.agent_version,
            date: fmtDateTime(last.started_at),
            passed: last.traces_passed ?? 0,
            total: last.traces_total ?? last.cases_total,
          });
  const metrics = [
    { label: t("columns.recall"), value: last?.recall, color: METRIC_COLORS.recall },
    { label: t("columns.precision"), value: last?.precision, color: METRIC_COLORS.precision },
    { label: t("columns.citation"), value: last?.citation_accuracy, color: METRIC_COLORS.citation },
  ];

  return (
    <button type="button" style={s.row} onClick={onOpen}>
      <span style={s.rowIcon}>
        <Icon.Cpu size={18} />
      </span>
      <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{row.agent_name}</span>
          <Badge color="var(--text-secondary)" mono>
            {row.model}
          </Badge>
        </span>
        <span style={s.rowSub}>{summary}</span>
      </span>
      {row.sparkline.length > 0 && (
        <Sparkline
          data={row.sparkline.length === 1 ? [row.sparkline[0]!, row.sparkline[0]!] : row.sparkline}
          color={METRIC_COLORS.recall}
          w={90}
          h={28}
        />
      )}
      {metrics.map((m) => (
        <span key={m.label} style={s.metric}>
          <span style={s.metricLabel}>{m.label}</span>
          <span className="tnum" style={{ ...s.metricValue, color: m.color }}>
            {pct(m.value)}
          </span>
        </span>
      ))}
      <Icon.ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
    </button>
  );
}

function RecentBatch({ batch }: { batch: EvalBatch }) {
  const t = useTranslations("eval.workspace");
  const bars = [
    { label: t("columns.recall"), value: batch.recall, color: METRIC_COLORS.recall },
    { label: t("columns.precision"), value: batch.precision, color: METRIC_COLORS.precision },
    { label: t("columns.citation"), value: batch.citation_accuracy, color: METRIC_COLORS.citation },
  ];
  return (
    <li style={s.recentItem}>
      <div style={s.recentHead}>
        <span style={{ fontWeight: 600 }}>{batch.agent_name}</span>
        <span className="mono" style={{ color: "var(--text-secondary)" }}>
          {fmtDateTime(batch.started_at)}
        </span>
        <span className="mono" style={{ color: "var(--accent)" }}>
          v{batch.agent_version}
        </span>
        <span className="tnum" style={{ marginLeft: "auto", fontWeight: 600 }}>
          {batch.traces_passed ?? 0}/{batch.traces_total ?? batch.cases_total}
        </span>
      </div>
      <div style={s.bars}>
        {bars.map((b) => (
          <BarRow
            key={b.label}
            label={b.label}
            value={b.value ?? 0}
            max={1}
            color={b.color}
            suffix={pct(b.value)}
          />
        ))}
      </div>
    </li>
  );
}

export function EvalDashboardView() {
  const t = useTranslations("eval.workspace");
  const router = useRouter();
  const qc = useQueryClient();
  const dashboard = useEvalWorkspaceDashboard();
  const runAll = useRunAllEvals();
  const [watching, setWatching] = React.useState<string[]>([]);

  const onWatched = React.useCallback(
    (id: string) => {
      setWatching((w) => w.filter((x) => x !== id));
      qc.invalidateQueries({ queryKey: ["eval-workspace-dashboard"] });
    },
    [qc],
  );

  const startAll = async () => {
    try {
      const res = await runAll.mutateAsync();
      notify.success(t("started", { started: res.started.length, skipped: res.skipped.length }));
      setWatching((w) => [...w, ...res.started.map((x) => x.batch_id)]);
    } catch {
      // surfaced by the mutation's global error toast
    }
  };

  const busy = runAll.isPending || watching.length > 0;

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>{t("title")}</h1>
        </div>
        <Button kind="primary" icon="Play" loading={busy} disabled={busy} onClick={startAll}>
          {t("runAll")}
        </Button>
      </div>
      {watching.map((id) => (
        <BatchWatcher key={id} batchId={id} onDone={onWatched} />
      ))}

      {dashboard.isError ? (
        <ErrorState body="" onRetry={() => dashboard.refetch()} />
      ) : dashboard.isLoading || !dashboard.data ? (
        <Skeleton height={220} />
      ) : (
        <>
          {dashboard.data.agents.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>{t("noAgents")}</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {dashboard.data.agents.map((row) => (
                <AgentRow
                  key={row.agent_id}
                  row={row}
                  onOpen={() => router.push(`/evals/${row.agent_id}`)}
                />
              ))}
            </div>
          )}

          <div style={{ marginTop: 28 }}>
            <SectionLabel icon="Clock">{t("recentTitle")}</SectionLabel>
          </div>
          <ul style={s.recentList} aria-label={t("recentTitle")}>
            {newestFirst(dashboard.data.recent_batches).slice(0, RECENT_LIMIT).map((b) => (
              <RecentBatch key={b.id} batch={b} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
