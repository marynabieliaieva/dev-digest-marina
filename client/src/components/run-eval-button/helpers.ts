import type { ApiError } from "@/lib/api";

/** True for a 409 `batch_running` error. */
export function isBatchConflictError(e: unknown): e is ApiError {
  return (
    typeof e === "object" && e !== null && (e as ApiError).status === 409 && (e as ApiError).code === "batch_running"
  );
}

/** The running batch id carried by a 409 `batch_running` error, but only when that
 *  batch has the wanted `scope` (a set run must not follow a single-case batch, and vice versa). */
export function batchIdFromConflict(e: ApiError, scope: "set" | "case" = "set"): string | null {
  if (e.status !== 409 || e.code !== "batch_running") return null;
  const d = e.details as { batch_id?: unknown; scope?: unknown } | null | undefined;
  return typeof d?.batch_id === "string" && d.scope === scope ? d.batch_id : null;
}
