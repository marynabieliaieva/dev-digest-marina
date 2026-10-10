import { ApiError } from "@/lib/api";

/** True when the API says the repo has no local clone to scan yet. */
export function isContextUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.code === "context_unavailable";
}
