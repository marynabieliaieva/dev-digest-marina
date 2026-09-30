import type { Intent } from '@devdigest/shared';

/**
 * Renders the review prompt's derived-intent block (plain text). The caller
 * (assemblePrompt) wraps it in <untrusted> — the intent is derived from
 * untrusted input (PR title/body, linked docs), so it is data, not instructions.
 */
export function renderIntentBlock(
  intent: Pick<Intent, 'summary' | 'in_scope' | 'out_of_scope' | 'risk_areas' | 'confidence'>,
  opts: { staleNote?: string } = {},
): string {
  const bullets = (items: string[]) =>
    items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : '- (none)';
  const lines: string[] = [
    `Summary: ${intent.summary}`,
    '',
    'In scope:',
    bullets(intent.in_scope),
    '',
    'Out of scope:',
    bullets(intent.out_of_scope),
    '',
    'Risk areas:',
    bullets(intent.risk_areas),
    '',
    `Confidence: ${intent.confidence}`,
  ];
  if (opts.staleNote && opts.staleNote.trim().length > 0) {
    lines.push('', `Note: ${opts.staleNote.trim()}`);
  }
  return lines.join('\n');
}
