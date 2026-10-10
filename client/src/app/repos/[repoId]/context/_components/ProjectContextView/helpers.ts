import { ApiError } from "@/lib/api";
import type { ContextDoc } from "@/lib/types";

export function isContextUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.code === "context_unavailable";
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

export function totalTokens(docs: ContextDoc[]): number {
  return docs.reduce((sum, d) => sum + d.est_tokens, 0);
}

/** Compact elapsed time since `updatedAt` (ms epoch), e.g. "<1m", "5m", "3h", "2d". */
export function relativeAgo(updatedAt: number, now: number = Date.now()): string {
  if (!updatedAt) return "<1m";
  const m = Math.max(0, Math.floor((now - updatedAt) / 60_000));
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** The selected doc if it still exists, else the first doc (or null). */
export function resolveSelected(docs: ContextDoc[], selected: string | null): string | null {
  if (selected && docs.some((d) => d.path === selected)) return selected;
  return docs[0]?.path ?? null;
}
