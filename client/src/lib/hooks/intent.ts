/* hooks/intent.ts — React Query hooks for the PR Intent card: read the stored
   intent (with its stale flag) and re-derive it on demand. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { PrIntentResponse } from "@devdigest/shared";

const intentKey = (prId: string | null | undefined) => ["pr-intent", prId] as const;

/** GET /pulls/:id/intent → stored intent (or null) + current head SHA; `stale` is computed server-side. */
export function usePrIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: intentKey(prId),
    queryFn: () => api.get<PrIntentResponse>(`/pulls/${prId}/intent`),
    enabled: !!prId,
  });
}

/** POST /pulls/:id/intent/derive → always re-derives; writes the fresh response
    into the query cache. Must be triggered from a user action, never an effect. */
export function useDeriveIntent(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrIntentResponse>(`/pulls/${prId}/intent/derive`),
    onSuccess: (data) => qc.setQueryData(intentKey(prId), data),
  });
}
