const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * New-side line ranges of a unified-diff patch, read from hunk headers ONLY.
 * Body lines are never inspected or returned, so no code reaches the prompt.
 * `+c,d` gives `[c, c+d-1]`; `d` defaults to 1; `d = 0` (pure deletion) gives no range.
 */
export function newSideRanges(patch: string | null): Array<[number, number]> {
  if (!patch) return [];
  const out: Array<[number, number]> = [];
  for (const line of patch.split('\n')) {
    const m = HUNK_HEADER.exec(line);
    if (!m) continue;
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    if (count <= 0) continue;
    out.push([start, start + count - 1]);
  }
  return out;
}
