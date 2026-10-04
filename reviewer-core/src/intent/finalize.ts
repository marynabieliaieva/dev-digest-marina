import type { Intent, IntentClassification, IntentConfidence, IntentSource } from '@devdigest/shared';

const MAX_ITEMS = 8;
const MAX_ITEM_CHARS = 200;

function clean(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const s = raw.trim().slice(0, MAX_ITEM_CHARS);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

const RANK: Record<IntentConfidence, number> = { low: 0, medium: 1, high: 2 };
const lowest = (a: IntentConfidence, b: IntentConfidence): IntentConfidence => (RANK[a] <= RANK[b] ? a : b);

const LINKED_KINDS = new Set(['linked_issue', 'repo_doc', 'external_doc']);

/**
 * Deterministic post-processing: tidy arrays, add a missing_context entry for
 * every source we could not read, and cap confidence (lowest cap wins).
 */
export function finalizeIntent(output: IntentClassification, sources: IntentSource[]): Intent {
  const missing = sources
    .filter((s) => s.status === 'unavailable' || s.status === 'unsupported' || s.status === 'skipped')
    .map((s) => `${s.ref} (${s.status}): ${s.reason ?? 'no reason given'}`);

  const bodyEmpty = sources.some((s) => s.kind === 'pr_body' && s.status === 'unavailable');
  const linkedUsed = sources.some(
    (s) => LINKED_KINDS.has(s.kind) && (s.status === 'used' || s.status === 'truncated'),
  );
  const anyUnreadable = sources.some(
    (s) => (s.status === 'unavailable' || s.status === 'unsupported') && s.kind !== 'pr_body',
  );

  let confidence = output.confidence;
  if (bodyEmpty) confidence = lowest(confidence, linkedUsed ? 'medium' : 'low');
  if (anyUnreadable) confidence = lowest(confidence, 'medium');

  return {
    summary: output.summary.trim(),
    in_scope: clean(output.in_scope),
    out_of_scope: clean(output.out_of_scope),
    risk_areas: clean(output.risk_areas),
    confidence,
    // Deterministic entries first so they survive the cap.
    missing_context: clean([...missing, ...output.missing_context]),
    sources,
  };
}
