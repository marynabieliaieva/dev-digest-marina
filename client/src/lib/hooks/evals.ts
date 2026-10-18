/* hooks/evals.ts — React Query hooks for the eval pipeline (L06): eval cases,
   batches (runs), dashboards and compare. One domain file, per client convention. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { notify } from "../toast";
import type {
  EvalBatch,
  EvalBatchDetail,
  EvalCaseDto,
  EvalCompare,
  EvalDashboard,
  EvalRunAllResult,
  EvalRunStarted,
  EvalWorkspaceDashboard,
  ReviewRecord,
} from "@devdigest/shared";

/** Poll interval while a batch is running (AC-39). */
export const EVAL_POLL_MS = 2000;

// ---- Eval cases ----
export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-cases", agentId],
    queryFn: () => api.get<EvalCaseDto[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

export function useEvalCase(caseId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-case", caseId],
    queryFn: () => api.get<EvalCaseDto>(`/eval-cases/${caseId}`),
    enabled: !!caseId,
  });
}

export interface CreateEvalCaseInput {
  findingId: string;
  /** PR the finding is shown on — keys the cached `["reviews", prId]` list. */
  prId: string;
  /** Agent that produced the finding — keys the cached `["eval-cases", agentId]` list. */
  agentId?: string | null;
}

/** "Turn into eval case". `silentError`: the FindingCard maps `ApiError.code`
   to its own toast copy (AC-16), so the global mutation toast must not also fire. */
export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId }: CreateEvalCaseInput) =>
      api.post<EvalCaseDto>(`/findings/${findingId}/eval-case`),
    meta: { silentError: true },
    onSuccess: (created, { findingId, prId, agentId }) => {
      qc.setQueryData<ReviewRecord[]>(["reviews", prId], (reviews) =>
        reviews?.map((r) => ({
          ...r,
          findings: r.findings.map((f) =>
            f.id === findingId ? { ...f, eval_case_id: created.id } : f,
          ),
        })),
      );
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-workspace-dashboard"] });
    },
    onError: (e, { prId, agentId }) => {
      // The finding is already a case but the cached review lacks `eval_case_id`:
      // refetch so the card shows "In eval set" from the prop.
      if (e instanceof ApiError && e.status === 409 && e.code === "already_eval_case") {
        qc.invalidateQueries({ queryKey: ["reviews", prId] });
        qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      }
    },
  });
}

export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId }: { caseId: string; agentId?: string | null }) =>
      api.del<void>(`/eval-cases/${caseId}`),
    onSuccess: (_d, { agentId }) => {
      // Findings carry `eval_case_id`; refresh them so "In eval set" resets.
      qc.invalidateQueries({ queryKey: ["reviews"] });
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-workspace-dashboard"] });
    },
  });
}

// ---- Runs (batches) ----
/** 409 `batch_running` is not an error to the user: callers follow the running batch. */
function isBatchConflict(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409 && e.code === "batch_running";
}

/** Toast every failure except the 409 conflict (the global toast is silenced via meta). */
function toastRunError(e: unknown) {
  if (isBatchConflict(e)) return;
  notify.error(e instanceof Error ? e.message : "Something went wrong");
}

/** Start a whole-set run for an agent (202 `{ batch_id }`). */
export function useRunAgentEvals() {
  return useMutation({
    mutationFn: (agentId: string) =>
      api.post<EvalRunStarted>(`/agents/${agentId}/eval-runs`),
    meta: { silentError: true },
    onError: toastRunError,
  });
}

/** Start a single-case run (scope `case`). */
export function useRunEvalCase() {
  return useMutation({
    mutationFn: (caseId: string) => api.post<EvalRunStarted>(`/eval-cases/${caseId}/run`),
    meta: { silentError: true },
    onError: toastRunError,
  });
}

/** Queue every eligible agent (workspace dashboard "Run all agents"). */
export function useRunAllEvals() {
  return useMutation({
    mutationFn: () => api.post<EvalRunAllResult>("/eval-runs/all"),
  });
}

export function useAgentEvalBatches(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-batches", agentId],
    queryFn: () => api.get<EvalBatch[]>(`/agents/${agentId}/eval-runs`),
    enabled: !!agentId,
  });
}

/** One batch with its runs; polls every 2 s while it is `running` (AC-39). */
export function useEvalBatch(batchId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-batch", batchId],
    queryFn: () => api.get<EvalBatchDetail>(`/eval-runs/${batchId}`),
    enabled: !!batchId,
    refetchInterval: (query) => {
      const { data, error } = query.state;
      if (data) return data.status === "running" ? EVAL_POLL_MS : false;
      // No data yet: a failed first fetch keeps polling, except a 404 (batch gone).
      if (error) return error instanceof ApiError && error.status === 404 ? false : EVAL_POLL_MS;
      return false;
    },
  });
}

// ---- Dashboards + compare ----
export function useAgentEvalDashboard(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-dashboard", agentId],
    queryFn: () => api.get<EvalDashboard>(`/agents/${agentId}/eval-dashboard`),
    enabled: !!agentId,
  });
}

export function useEvalWorkspaceDashboard() {
  return useQuery({
    queryKey: ["eval-workspace-dashboard"],
    queryFn: () => api.get<EvalWorkspaceDashboard>("/eval-dashboard"),
  });
}

export function useEvalCompare(base: string | null | undefined, head: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-compare", base, head],
    queryFn: () =>
      api.get<EvalCompare>(
        `/eval-runs/compare?base=${encodeURIComponent(base!)}&head=${encodeURIComponent(head!)}`,
      ),
    enabled: !!base && !!head,
  });
}
