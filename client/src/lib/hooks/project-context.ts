/* hooks/project-context.ts — React Query hooks for Project Context: the repo's
   doc list/preview and the ordered doc attachments of agents and skills. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { AgentContext, ContextDocContent, ContextDocList, ContextPaths } from "../types";

/** GET /repos/:id/context → docs found in the clone (rescanned on every fetch). */
export function useContextDocs(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context", repoId],
    queryFn: () => api.get<ContextDocList>(`/repos/${repoId}/context`),
    enabled: !!repoId,
  });
}

/** GET /repos/:id/context/file?path= → one document's content. */
export function useContextDoc(repoId: string | null | undefined, path: string | null | undefined) {
  return useQuery({
    queryKey: ["context-doc", repoId, path],
    queryFn: () =>
      api.get<ContextDocContent>(
        `/repos/${repoId}/context/file?path=${encodeURIComponent(path ?? "")}`,
      ),
    enabled: !!repoId && !!path,
  });
}

/** GET /agents/:id/context → direct paths + paths inherited from linked skills. */
export function useAgentContext(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-context", agentId],
    queryFn: () => api.get<AgentContext>(`/agents/${agentId}/context`),
    enabled: !!agentId,
  });
}

export function useSetAgentContext(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ContextPaths) => api.put<AgentContext>(`/agents/${agentId}/context`, body),
    onSuccess: (data) => {
      qc.setQueryData(["agent-context", agentId], data);
      qc.invalidateQueries({ queryKey: ["context"] });
    },
  });
}

/** GET /skills/:id/context → paths attached to the skill. */
export function useSkillContext(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-context", skillId],
    queryFn: () => api.get<ContextPaths>(`/skills/${skillId}/context`),
    enabled: !!skillId,
  });
}

export function useSetSkillContext(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ContextPaths) => api.put<ContextPaths>(`/skills/${skillId}/context`, body),
    onSuccess: (data) => {
      qc.setQueryData(["skill-context", skillId], data);
      qc.invalidateQueries({ queryKey: ["context"] });
      qc.invalidateQueries({ queryKey: ["agent-context"] });
    },
  });
}
