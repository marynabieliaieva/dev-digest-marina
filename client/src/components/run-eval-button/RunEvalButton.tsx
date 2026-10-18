/* RunEvalButton — starts an eval batch and follows it to the end. Shared by the
   Evals tab ("Run all evals") and the agent eval page ("Run eval").
   While a batch runs it shows "Running <done>/<total>", is disabled and polls
   (via useEvalBatch, 2 s). `runningBatchId` resumes a batch that was already
   running when the page loaded (AC-40). On a terminal status it refreshes the
   eval queries and toasts the outcome (AC-41). */
"use client";

import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import { notify } from "@/lib/toast";
import { useEvalBatch } from "@/lib/hooks/evals";
import { batchIdFromConflict, isBatchConflictError } from "./helpers";

export interface RunEvalButtonProps {
  label: string;
  /** A batch already running for this agent (from the dashboard); resumes polling. */
  runningBatchId?: string | null;
  /** Starts the run; resolves with the new batch id. */
  onStart: () => Promise<{ batch_id: string }>;
  disabled?: boolean;
  /** Called once when the followed batch reaches `done` or `failed`. */
  onFinished?: () => void;
}

export function RunEvalButton({
  label,
  runningBatchId,
  onStart,
  disabled,
  onFinished,
}: RunEvalButtonProps) {
  const t = useTranslations("eval");
  const qc = useQueryClient();
  const [startedId, setStartedId] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [handled, setHandled] = React.useState<string[]>([]);
  const onFinishedRef = React.useRef(onFinished);
  React.useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  const candidate = startedId ?? runningBatchId ?? null;
  const batchId = candidate && !handled.includes(candidate) ? candidate : null;
  const { data: batch, error: batchError } = useEvalBatch(batchId);

  // A vanished batch (404) must end the "running" state; other fetch errors keep polling.
  React.useEffect(() => {
    if (!batchId || batch || !(batchError instanceof ApiError) || batchError.status !== 404) return;
    setHandled((h) => (h.includes(batchId) ? h : [...h, batchId]));
    setStartedId(null);
  }, [batchId, batch, batchError]);

  React.useEffect(() => {
    if (!batchId || !batch || batch.id !== batchId) return;
    if (batch.status === "running") return;

    setHandled((h) => (h.includes(batchId) ? h : [...h, batchId]));
    setStartedId(null);

    qc.invalidateQueries({ queryKey: ["eval-cases", batch.agent_id] });
    qc.invalidateQueries({ queryKey: ["eval-batches", batch.agent_id] });
    qc.invalidateQueries({ queryKey: ["eval-dashboard", batch.agent_id] });
    qc.invalidateQueries({ queryKey: ["eval-workspace-dashboard"] });

    if (batch.status === "done") {
      notify.success(
        t("run.finished", {
          passed: batch.traces_passed ?? 0,
          total: batch.traces_total ?? batch.cases_total,
        }),
      );
    } else {
      notify.error(t("run.failed", { error: batch.error ?? "" }));
    }
    onFinishedRef.current?.();
  }, [batchId, batch, qc, t]);

  const start = async () => {
    setStarting(true);
    try {
      const { batch_id } = await onStart();
      setStartedId(batch_id);
    } catch (e) {
      // 409 batch_running: follow the batch that is already running.
      const existing = e instanceof ApiError ? batchIdFromConflict(e, "set") : null;
      if (existing) setStartedId(existing);
      else if (e instanceof ApiError && isBatchConflictError(e)) notify.info(t("run.alreadyRunning"));
      // Other failures are toasted by the run hooks (the 409 is deliberately silent).
    } finally {
      setStarting(false);
    }
  };

  const running = batchId !== null;
  const text = running
    ? t("run.running", { done: batch?.cases_done ?? 0, total: batch?.cases_total ?? 0 })
    : starting
      ? t("run.starting")
      : label;

  return (
    <Button
      kind="primary"
      icon="Play"
      loading={running || starting}
      disabled={disabled || running || starting}
      onClick={start}
    >
      {text}
    </Button>
  );
}
