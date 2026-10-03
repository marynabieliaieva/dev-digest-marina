/* hooks/blast.ts — React Query hook for the PR Blast Radius block: read the
   indexed blast radius (with its degraded/index-status envelope). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadiusResponse } from "@devdigest/shared";

export const blastKey = (prId: string | null | undefined) => ["pr-blast", prId] as const;

/** GET /pulls/:id/blast → blast radius + index status / degraded reason. */
export function usePrBlast(prId: string | null | undefined) {
  return useQuery({
    queryKey: blastKey(prId),
    queryFn: () => api.get<BlastRadiusResponse>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}
