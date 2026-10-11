/* hooks/brief.ts — React Query hooks for the PR Brief card: read the stored
   brief (with its stale/generating flags), regenerate it, and auto-refresh a
   stale one once per (PR, head SHA). */
"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { PrBriefRequest, PrBriefResponse } from "@devdigest/shared";

export type BriefMode = PrBriefRequest["mode"];
export type GenerateBriefVars = { mode: BriefMode };

/** Poll interval while the server reports `generating: true` (AC-25). */
export const BRIEF_POLL_MS = 2000;

const briefKey = (prId: string | null | undefined, headSha: string | null | undefined) =>
  ["pr-brief", prId, headSha] as const;

/* Module-scope de-dupe for the auto-regeneration POST (AC-24). Keyed
   `${prId}:${current_head_sha}`; the key is added BEFORE mutate() and never
   removed, so a failure is not retried (NG8). Deliberately not a useRef: a ref
   guard breaks under Strict Mode's effect replay (client/INSIGHTS.md). */
const attempted = new Set<string>();

/** Test-only: forget which (PR, head SHA) pairs already auto-regenerated. */
export function __resetBriefAutoRegen() {
  attempted.clear();
}

/** True for the `brief_in_progress` conflict returned while another run holds the lock. */
export function isBriefConflict(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

/** GET /pulls/:id/brief → stored brief + current head SHA + stale/generating flags. */
export function usePrBrief(prId: string | null | undefined, headSha: string | null | undefined) {
  return useQuery({
    queryKey: briefKey(prId, headSha),
    queryFn: () => api.get<PrBriefResponse>(`/pulls/${prId}/brief`),
    enabled: !!prId && !!headSha,
    refetchInterval: (query) => (query.state.data?.generating ? BRIEF_POLL_MS : false),
  });
}

/** POST /pulls/:id/brief → writes the fresh response into the query cache. A 409
    (another run in progress) flips the cached `generating` flag so the query polls. */
export function useGenerateBrief(prId: string | null | undefined, headSha: string | null | undefined) {
  const qc = useQueryClient();
  const key = briefKey(prId, headSha);
  return useMutation({
    mutationFn: (vars: GenerateBriefVars) => api.post<PrBriefResponse>(`/pulls/${prId}/brief`, vars),
    onSuccess: (data) => {
      qc.setQueryData(key, data);
    },
    onError: (err) => {
      if (!isBriefConflict(err)) return;
      qc.setQueryData<PrBriefResponse>(key, (old) => (old ? { ...old, generating: true } : old));
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}

/** Query + mutation + the one-shot auto-regeneration of a stale brief (AC-24). */
export function useBrief(prId: string | null | undefined, headSha: string | null | undefined) {
  const query = usePrBrief(prId, headSha);
  const generate = useGenerateBrief(prId, headSha);

  const data = query.data;
  const pending = generate.isPending || !!data?.generating;
  const mutate = generate.mutate;

  const staleKey = data && data.brief && data.stale ? `${prId}:${data.current_head_sha}` : null;
  useEffect(() => {
    if (!staleKey || pending || attempted.has(staleKey)) return;
    attempted.add(staleKey);
    mutate({ mode: "if_stale" });
  }, [staleKey, pending, mutate]);

  const error = generate.isError && !isBriefConflict(generate.error) ? generate.error : null;

  return {
    data,
    isLoading: query.isLoading,
    pending,
    error,
    generate: (mode: BriefMode) => mutate({ mode }),
    /** Re-sends whatever the failed request was (defaults to a refresh). */
    retry: () => mutate(generate.variables ?? { mode: "refresh" }),
  };
}
