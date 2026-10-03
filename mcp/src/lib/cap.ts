export const DEFAULT_MAX_RESPONSE_CHARS = 32_000;

/**
 * Cap a response at `maxChars` (~8k tokens, D9). Cuts at a line boundary when
 * possible and appends a hint telling the model how to get less/other data.
 * The result (hint included) never exceeds `maxChars`.
 */
export function capResponse(text: string, maxChars = DEFAULT_MAX_RESPONSE_CHARS): string {
  if (text.length <= maxChars) return text;
  const hint = (shown: number) =>
    `\n\n[truncated: showing ${shown} of ${text.length} chars. Narrow the request: use filters, response_format:'concise', or offset/limit.]`;
  const reserve = hint(text.length).length;
  // Limit too small to fit even the hint: hard cut so the limit is still honoured.
  if (maxChars <= reserve) return text.slice(0, maxChars);
  const budget = maxChars - reserve;
  let cut = text.slice(0, budget);
  const lastNewline = cut.lastIndexOf('\n');
  if (lastNewline > budget * 0.5) cut = cut.slice(0, lastNewline);
  return cut + hint(cut.length);
}
