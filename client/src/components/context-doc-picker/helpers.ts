import type { ContextDoc, ContextDocType } from "@devdigest/shared";

/** Docs above this size are skipped by the server when assembling the prompt. */
export const MAX_DOC_BYTES = 65536;
/** Effective token budget for an agent's Project context block. */
export const TOKEN_BUDGET = 20000;

export type InheritedRef = { path: string; skill_name: string };

export type PickerRow = {
  path: string;
  /** Folder portion of the path with trailing slash ("" at repo root). */
  folder: string;
  name: string;
  type: ContextDocType | null;
  size: number;
  est_tokens: number;
  state: "attached" | "inherited" | "available" | "missing";
  /** Skill name for inherited rows. */
  via?: string;
  tooLarge: boolean;
};

export function splitPath(path: string): { folder: string; name: string } {
  const i = path.lastIndexOf("/");
  return i < 0 ? { folder: "", name: path } : { folder: path.slice(0, i + 1), name: path.slice(i + 1) };
}

function fromDoc(doc: ContextDoc, state: PickerRow["state"], via?: string): PickerRow {
  const { folder, name } = splitPath(doc.path);
  return {
    path: doc.path,
    folder,
    name,
    type: doc.type,
    size: doc.size,
    est_tokens: doc.est_tokens,
    state,
    via,
    tooLarge: doc.size > MAX_DOC_BYTES,
  };
}

/**
 * Attached rows first (persisted order; absent files become `missing`), then
 * read-only inherited rows, then the rest alphabetically.
 */
export function buildRows(
  docs: ContextDoc[] | undefined,
  attached: string[],
  inherited: InheritedRef[] = [],
): PickerRow[] {
  const byPath = new Map((docs ?? []).map((d) => [d.path, d]));
  const attachedSet = new Set(attached);
  const rows: PickerRow[] = [];

  for (const path of attached) {
    const doc = byPath.get(path);
    if (doc) {
      rows.push(fromDoc(doc, "attached"));
    } else {
      const { folder, name } = splitPath(path);
      rows.push({ path, folder, name, type: null, size: 0, est_tokens: 0, state: "missing", tooLarge: false });
    }
  }

  const inheritedSeen = new Set<string>();
  for (const ref of inherited) {
    if (attachedSet.has(ref.path) || inheritedSeen.has(ref.path)) continue;
    inheritedSeen.add(ref.path);
    const doc = byPath.get(ref.path);
    if (doc) {
      rows.push(fromDoc(doc, "inherited", ref.skill_name));
    } else {
      const { folder, name } = splitPath(ref.path);
      rows.push({
        path: ref.path,
        folder,
        name,
        type: null,
        size: 0,
        est_tokens: 0,
        state: "inherited",
        via: ref.skill_name,
        tooLarge: false,
      });
    }
  }

  const rest = (docs ?? [])
    .filter((d) => !attachedSet.has(d.path) && !inheritedSeen.has(d.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((d) => fromDoc(d, "available"));

  return [...rows, ...rest];
}

/** Case-insensitive path substring filter. */
export function filterRows(rows: PickerRow[], q: string): PickerRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => r.path.toLowerCase().includes(needle));
}

/** Sum of est_tokens over attached + inherited rows, de-duplicated by path. */
export function effectiveTokens(rows: PickerRow[]): number {
  const seen = new Set<string>();
  let total = 0;
  for (const r of rows) {
    if (r.state !== "attached" && r.state !== "inherited") continue;
    if (seen.has(r.path)) continue;
    seen.add(r.path);
    total += r.est_tokens;
  }
  return total;
}

/** Move the item at `from` to index `to`; returns the same array when a no-op. */
export function reorderAttached(paths: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= paths.length || to >= paths.length) return paths;
  const next = [...paths];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}
