/* hooks/conventions.ts — React Query hooks for the Conventions page:
   scan (extract), poll while running, accept/reject/edit a candidate, and the
   merge-to-skill preview + save flow. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ConventionCandidate,
  ConventionCategory,
  ConventionsPage,
  ConventionStatus,
  Skill,
} from "@devdigest/shared";

/** GET /repos/:id/conventions → latest extraction + its candidates. Polls
    every 1.5s while the extraction is still running, same shape as
    useRepoIntelStatus(…, poll). */
export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionsPage>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
    refetchInterval: (query) =>
      query.state.data?.extraction?.status === "running" ? 1500 : false,
  });
}

/** POST /repos/:id/conventions/extract → 202 { extraction_id } (enqueue a scan). */
export function useExtractConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ extractionId: string }>(`/repos/${repoId}/conventions/extract`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

export interface UpdateConventionInput {
  id: string;
  repoId: string;
  patch: { status?: ConventionStatus; rule?: string; category?: ConventionCategory };
}

/** PATCH /conventions/:id — accept/reject/edit. Optimistic status flip so the
    card responds instantly; rolled back on error. */
export function useUpdateConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onMutate: async ({ id, repoId, patch }) => {
      const key = ["conventions", repoId];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ConventionsPage>(key);
      if (previous) {
        qc.setQueryData<ConventionsPage>(key, {
          ...previous,
          candidates: previous.candidates.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        });
      }
      return { previous };
    },
    onError: (_err, { repoId }, ctx) => {
      if (ctx?.previous) qc.setQueryData(["conventions", repoId], ctx.previous);
    },
    onSettled: (_d, _e, { repoId }) => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

export interface SkillPreview {
  name: string;
  description: string;
  type: Skill["type"];
  body: string;
  token_count: number;
}

/** POST /repos/:id/conventions/skill-preview — draft a merged skill body. Persists NOTHING. */
export function useConventionSkillPreview(repoId: string | null | undefined) {
  return useMutation({
    mutationFn: (candidateIds: string[]) =>
      api.post<SkillPreview>(`/repos/${repoId}/conventions/skill-preview`, {
        candidate_ids: candidateIds,
      }),
  });
}

export interface CreateSkillFromConventionsInput {
  name: string;
  description: string;
  type: Skill["type"];
  body: string;
  enabled: boolean;
  candidateIds: string[];
  agentId?: string;
}

/** POST /repos/:id/conventions/skill — save the merged skill, stamp the
    accepted candidates, optionally link it to an agent. */
export function useCreateSkillFromConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillFromConventionsInput) =>
      api.post<Skill>(`/repos/${repoId}/conventions/skill`, {
        name: input.name,
        description: input.description,
        type: input.type,
        body: input.body,
        enabled: input.enabled,
        candidate_ids: input.candidateIds,
        ...(input.agentId ? { agent_id: input.agentId } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}
