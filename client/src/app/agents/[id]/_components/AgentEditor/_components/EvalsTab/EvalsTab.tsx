/* EvalsTab — the agent's eval cases: metric tiles, "Run all evals", the case
   list (run / view / delete) and a read-only case panel. Cases are created from
   a finding on the PR page, so "+ New eval case" only explains how. */
"use client";

import React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button, Icon, IconBtn } from "@devdigest/ui";
import type { Agent, EvalCaseDto } from "@devdigest/shared";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EvalMetricTile } from "@/components/eval-metric-tile";
import { RunEvalButton } from "@/components/run-eval-button";
import { ApiError } from "@/lib/api";
import { batchIdFromConflict, isBatchConflictError } from "@/components/run-eval-button/helpers";
import { notify } from "@/lib/toast";
import {
  useAgentEvalDashboard,
  useDeleteEvalCase,
  useEvalBatch,
  useEvalCases,
  useRunAgentEvals,
  useRunEvalCase,
} from "@/lib/hooks/evals";
import { CaseViewPanel } from "./_components/CaseViewPanel";
import { caseStatus, newestFirst, passingCount, resultText, tileData, type CaseStatus } from "./helpers";
import { s } from "./styles";

const STATUS_ICON: Record<CaseStatus, { Icon: typeof Icon.CheckCircle; color: string; key: string }> = {
  pass: { Icon: Icon.CheckCircle, color: "var(--ok)", key: "evalsTab.statusPass" },
  fail: { Icon: Icon.XCircle, color: "var(--crit)", key: "evalsTab.statusFail" },
  error: { Icon: Icon.AlertTriangle, color: "var(--warn)", key: "evalsTab.statusError" },
  never: { Icon: Icon.Dot, color: "var(--text-muted)", key: "evalsTab.statusNever" },
};

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");
  const qc = useQueryClient();
  const casesQ = useEvalCases(agent.id);
  const dashQ = useAgentEvalDashboard(agent.id);
  const runAgent = useRunAgentEvals();
  const runCase = useRunEvalCase();
  const del = useDeleteEvalCase();

  const [showHelp, setShowHelp] = React.useState(false);
  const [viewId, setViewId] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<EvalCaseDto | null>(null);
  const [rowBatchId, setRowBatchId] = React.useState<string | null>(null);

  // A single-case run: follow it, then refresh the lists and toast the outcome.
  const { data: rowBatch, error: rowBatchError } = useEvalBatch(rowBatchId);
  // A vanished row batch (404) must not leave every row's ▶ dead.
  React.useEffect(() => {
    if (rowBatchId && !rowBatch && rowBatchError instanceof ApiError && rowBatchError.status === 404) {
      setRowBatchId(null);
    }
  }, [rowBatchId, rowBatch, rowBatchError]);
  React.useEffect(() => {
    if (!rowBatchId || !rowBatch || rowBatch.id !== rowBatchId || rowBatch.status === "running") return;
    setRowBatchId(null);
    qc.invalidateQueries({ queryKey: ["eval-cases", agent.id] });
    qc.invalidateQueries({ queryKey: ["eval-batches", agent.id] });
    qc.invalidateQueries({ queryKey: ["eval-dashboard", agent.id] });
    qc.invalidateQueries({ queryKey: ["eval-workspace-dashboard"] });
    if (rowBatch.status === "done") {
      notify.success(
        t("run.finished", {
          passed: rowBatch.traces_passed ?? 0,
          total: rowBatch.traces_total ?? rowBatch.cases_total,
        }),
      );
    } else {
      notify.error(t("run.failed", { error: rowBatch.error ?? "" }));
    }
  }, [rowBatchId, rowBatch, qc, agent.id, t]);

  const cases = newestFirst(casesQ.data ?? []);
  const viewed = cases.find((c) => c.id === viewId) ?? null;
  const tiles = tileData(dashQ.data);
  const current = dashQ.data?.current ?? null;

  const startRow = (c: EvalCaseDto) => {
    runCase.mutate(c.id, {
      onSuccess: ({ batch_id }) => setRowBatchId(batch_id),
      onError: (e) => {
        if (!isBatchConflictError(e)) return; // other failures are toasted by the hook
        // Follow a running single-case batch; a running set batch just gets a notice.
        const existing = batchIdFromConflict(e, "case");
        if (existing) setRowBatchId(existing);
        else notify.info(t("run.alreadyRunning"));
      },
    });
  };

  const confirmDelete = () => {
    if (!deleting) return;
    del.mutate({ caseId: deleting.id, agentId: agent.id }, { onSuccess: () => setDeleting(null) });
  };

  return (
    <div style={s.wrap}>
      <div>
        <div style={s.metricsHead}>
          <span style={s.metricsTitle}>{t("metrics.title")}</span>
          <Link href={`/evals/${agent.id}`} style={s.link}>
            {t("evalsTab.viewDashboard")}
          </Link>
        </div>
        <div style={{ ...s.tiles, marginTop: 12 }}>
          <EvalMetricTile
            label={t("metrics.recall")}
            value={tiles.recall}
            previous={tiles.prevRecall}
            spark={tiles.sparkRecall}
          />
          <EvalMetricTile
            label={t("metrics.precision")}
            value={tiles.precision}
            previous={tiles.prevPrecision}
            spark={tiles.sparkPrecision}
            color="var(--ok)"
          />
          <EvalMetricTile
            label={t("metrics.citation")}
            value={tiles.citation}
            previous={tiles.prevCitation}
            spark={tiles.sparkCitation}
            color="var(--warn)"
          />
          <EvalMetricTile
            label={t("metrics.tracesPassed")}
            value={null}
            valueText={current ? `${current.traces_passed}/${current.traces_total}` : "—"}
            deltaText=""
          />
        </div>
      </div>

      <div>
        <div style={s.casesHead}>
          <h2 style={s.casesTitle}>
            {t("evalsTab.header", { passed: passingCount(cases), total: cases.length })}
          </h2>
          <div style={s.actions}>
            <RunEvalButton
              label={t("run.runAll")}
              runningBatchId={dashQ.data?.running_batch_id ?? null}
              disabled={cases.length === 0}
              onStart={() => runAgent.mutateAsync(agent.id)}
            />
            <Button kind="secondary" icon="Plus" onClick={() => setShowHelp((v) => !v)}>
              {t("evalsTab.newEvalCase")}
            </Button>
          </div>
        </div>

        {showHelp && (
          <p role="note" style={{ ...s.instructions, marginTop: 12 }}>
            {t("evalsTab.emptyInstructions")}
          </p>
        )}

        {cases.length === 0 && !casesQ.isLoading ? (
          <p style={s.empty}>{t("evalsTab.emptyCases")}</p>
        ) : (
          <ul style={{ ...s.list, marginTop: 14 }}>
            {cases.map((c) => {
              const st = caseStatus(c);
              const si = STATUS_ICON[st];
              return (
                <li key={c.id} style={s.row}>
                  <span role="img" aria-label={t(si.key)} style={{ color: si.color, display: "inline-flex" }}>
                    <si.Icon size={20} />
                  </span>
                  <div style={s.rowMain}>
                    <div style={s.name} title={c.name}>
                      {c.name}
                    </div>
                    <div style={s.result}>{resultText(c, t)}</div>
                  </div>
                  <span style={s.chip}>
                    {c.expectation.severity} · {c.expectation.category}
                  </span>
                  <div style={s.icons}>
                    <IconBtn
                      icon="Play"
                      label={t("evalsTab.runCase", { name: c.name })}
                      onClick={() => !rowBatchId && startRow(c)}
                    />
                    <IconBtn icon="Eye" label={t("evalsTab.viewCase", { name: c.name })} onClick={() => setViewId(c.id)} />
                    <IconBtn
                      icon="Trash"
                      danger
                      label={t("evalsTab.deleteCase", { name: c.name })}
                      onClick={() => setDeleting(c)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {viewed && <CaseViewPanel evalCase={viewed} onClose={() => setViewId(null)} />}
      {deleting && (
        <ConfirmDialog
          title={t("evalsTab.deleteTitle")}
          body={t("evalsTab.deleteBody")}
          confirmLabel={t("evalsTab.deleteConfirm")}
          cancelLabel={t("evalsTab.deleteCancel")}
          pending={del.isPending}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
