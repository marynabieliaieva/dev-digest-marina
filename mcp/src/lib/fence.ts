/** Truncate to `max` chars, marking the cut with an ellipsis. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Render untrusted text (code snippets, rationale from a model/repo) as an
 * inert fenced block: truncated, and fenced with a delimiter longer than any
 * backtick run inside so the content cannot close the fence and smuggle
 * instructions into the surrounding markdown (prompt-injection hygiene).
 */
export function fence(text: string, max = 300, lang = ''): string {
  const body = truncate(text, max);
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((m) => m.length));
  const delim = '`'.repeat(Math.max(3, longest + 1));
  return `${delim}${lang}\n${body}\n${delim}`;
}
