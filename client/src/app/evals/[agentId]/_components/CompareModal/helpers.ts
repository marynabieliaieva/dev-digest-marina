import type { EvalConfigSnapshot } from "@devdigest/shared";

/** Skill names frozen in a batch snapshot (sorted; empty when the snapshot is absent). */
export function skillNames(snapshot: EvalConfigSnapshot | undefined): string[] {
  return (snapshot?.skills ?? []).map((sk) => sk.name).sort();
}
