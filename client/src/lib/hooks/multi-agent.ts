/* hooks/multi-agent.ts — React Query hooks for the multi-agent review:
   per-agent run estimates, the latest multi-run of a PR (polled while running)
   and the start mutation. One domain file, per client convention. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { AgentRunEstimates, MultiAgentRun } from "@devdigest/shared";

/** Poll interval while a multi-run is still running. */
export const MULTI_AGENT_POLL_MS = 2000;

export function useRunEstimates() {
  return useQuery({
    queryKey: ["run-estimates"],
    queryFn: () => api.get<AgentRunEstimates>("/agents/run-estimates"),
  });
}

/** Latest multi-run of a PR. Resolves to `null` when none exists yet (404). */
export function useMultiAgentRun(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent", prId],
    queryFn: async (): Promise<MultiAgentRun | null> => {
      try {
        return await api.get<MultiAgentRun>(`/pulls/${prId}/multi-agent`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404 && e.code === "no_multi_agent_run") {
          return null;
        }
        throw e;
      }
    },
    enabled: !!prId,
    refetchInterval: (q) => (q.state.data?.status === "running" ? MULTI_AGENT_POLL_MS : false),
  });
}

export function useStartMultiAgentRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentIds }: { prId: string; agentIds: string[] }) =>
      api.post<MultiAgentRun>(`/pulls/${prId}/multi-agent-run`, { agentIds }),
    onSuccess: (data, { prId }) => {
      qc.setQueryData(["multi-agent", prId], data);
      qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
      qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
    },
  });
}
