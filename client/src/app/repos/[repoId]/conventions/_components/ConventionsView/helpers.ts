import type { ConventionCandidate } from "@devdigest/shared";

export function acceptedIds(candidates: ConventionCandidate[]): string[] {
  return candidates.filter((c) => c.status === "accepted").map((c) => c.id);
}

/** "just now" / "5m ago" / "3h ago" / "2d ago" — coarse, matches the plan's
    "Detected from N sample files · last scan 1h ago" subtitle. */
export function formatScanTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
