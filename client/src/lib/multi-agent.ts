/* multi-agent.ts — pure helpers for the multi-agent review UI: estimate labels,
   selection logic, error decoding and the URL contract. No React, no i18n. */
import { ApiError } from "./api";
import { formatCost } from "./format-cost";

/** Maximum agents per multi-agent run (mirrors the server limit). */
export const MAX_AGENTS = 5;

/** The subset of `AgentRunEstimate` the label helpers need. */
export interface Estimate {
  est_duration_ms: number | null;
  est_cost_usd: number | null;
}

/** Milliseconds → seconds with one decimal ("8.2"). */
export function estimateSeconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}

/** "~8s" or null when there is no duration estimate. */
export function estimateLabelShort(est: Estimate | null | undefined): string | null {
  if (!est || est.est_duration_ms == null) return null;
  return `~${Math.round(est.est_duration_ms / 1000)}s`;
}

/** "8.2s · $0.06" or null when there is no estimate at all. */
export function estimateLabelCard(est: Estimate | null | undefined): string | null {
  if (!est) return null;
  const parts: string[] = [];
  if (est.est_duration_ms != null) parts.push(`${estimateSeconds(est.est_duration_ms)}s`);
  if (est.est_cost_usd != null) parts.push(formatCost(est.est_cost_usd));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Footer total for the ticked agents: T = slowest duration (parallel fan-out),
 * C = summed cost. `partial` when any ticked agent has no estimate; null when
 * none has one.
 */
export function estimateFooter(
  ests: Array<Estimate | null | undefined>,
): { text: string; partial: boolean } | null {
  const durations: number[] = [];
  const costs: number[] = [];
  let missing = false;
  for (const e of ests) {
    const hasAny = !!e && (e.est_duration_ms != null || e.est_cost_usd != null);
    if (!hasAny) {
      missing = true;
      continue;
    }
    if (e!.est_duration_ms != null) durations.push(e!.est_duration_ms);
    else missing = true;
    if (e!.est_cost_usd != null) costs.push(e!.est_cost_usd);
  }
  if (durations.length === 0 && costs.length === 0) return null;
  const parts: string[] = [];
  if (durations.length > 0) parts.push(estimateSeconds(Math.max(...durations)) + "s");
  if (costs.length > 0) parts.push(formatCost(costs.reduce((a, b) => a + b, 0)));
  return { text: `≈ ${parts.join(" · ")}`, partial: missing };
}

/** Tick/untick `id`; ticking is ignored once `max` ids are selected. */
export function toggleAgent(selected: string[], id: string, max = MAX_AGENTS): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  if (selected.length >= max) return selected;
  return [...selected, id];
}

/** "Select all": the first `max` ids, in order. */
export function selectFirst(ids: string[], max = MAX_AGENTS): string[] {
  return ids.slice(0, max);
}

/** Agent names from a 409 `agents_already_running` error, else null. */
export function alreadyRunningAgents(err: unknown): string[] | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const details = err.details as { agents?: unknown } | null | undefined;
  const agents = details?.agents;
  if (!Array.isArray(agents)) return null;
  return agents.filter((a): a is string => typeof a === "string");
}

/** Results page URL: `/repos/:repoId/multi-agent?pr=<n>[&…extra]`. */
export function resultsHref(
  repoId: string,
  prNumber: number,
  extra?: Record<string, string | number | undefined>,
): string {
  const q = new URLSearchParams({ pr: String(prNumber) });
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v !== undefined) q.set(k, String(v));
  }
  return `/repos/${repoId}/multi-agent?${q.toString()}`;
}

/** Configure screen URL: `/repos/:repoId/multi-agent?configure=1[&pr=<n>]`. */
export function configureHref(repoId: string, prNumber?: number): string {
  const q = new URLSearchParams({ configure: "1" });
  if (prNumber !== undefined) q.set("pr", String(prNumber));
  return `/repos/${repoId}/multi-agent?${q.toString()}`;
}
