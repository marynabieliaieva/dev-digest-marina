import type { UnifiedDiff } from '@devdigest/shared';

/**
 * File outline for the intent classifier: path + change counts + hunk HEADER
 * lines only (`@@ -a,b +c,d @@ <context>`). Diff body lines are never copied,
 * so the classifier request cannot contain diff bodies.
 */
export interface FileOutline {
  path: string;
  additions: number;
  deletions: number;
  hunk_headers: string[];
}

export const MAX_OUTLINE_FILES = 100;
export const MAX_HEADERS_PER_FILE = 10;
export const MAX_HEADER_CHARS = 160;

const HUNK_HEADER = /^@@ [^@]+ @@.*$/;

function headersFromLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (out.length >= MAX_HEADERS_PER_FILE) break;
    // Body lines are prefixed with '+', '-' or ' ', so a line starting with
    // '@@' is always a real hunk header.
    if (HUNK_HEADER.test(line)) out.push(line.slice(0, MAX_HEADER_CHARS));
  }
  return out;
}

export function outlineFromPatches(
  files: { path: string; additions: number; deletions: number; patch: string | null }[],
): FileOutline[] {
  return files.slice(0, MAX_OUTLINE_FILES).map((f) => ({
    path: f.path,
    additions: f.additions,
    deletions: f.deletions,
    hunk_headers: headersFromLines(f.patch ? f.patch.split(/\r?\n/) : []),
  }));
}

/** Split a raw unified diff into per-file sections, then keep headers only. */
export function outlineFromDiff(diff: UnifiedDiff): FileOutline[] {
  const perFile = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of diff.raw.split(/\r?\n/)) {
    const m = /^diff --git a\/.* b\/(.*)$/.exec(line);
    if (m) {
      current = [];
      perFile.set(m[1]!, current);
      continue;
    }
    if (current && line.startsWith('@@')) current.push(line);
  }
  return diff.files.slice(0, MAX_OUTLINE_FILES).map((f) => ({
    path: f.path,
    additions: f.additions,
    deletions: f.deletions,
    hunk_headers: headersFromLines(perFile.get(f.path) ?? []),
  }));
}
