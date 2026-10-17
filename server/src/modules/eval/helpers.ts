import type { EvalCompare } from '@devdigest/shared';
import { ALERT_DROP_PTS, STALE_BATCH_MS } from './constants.js';

/** Pure helpers for the eval module: alert rule, prompt diff, compare delta, stale predicate. */

export interface AlertMetrics {
  agent_version: number;
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
}

const ALERT_METRICS = [
  { key: 'recall', label: 'Recall', reason: 'an expected finding was missed' },
  { key: 'precision', label: 'Precision', reason: 'a new false positive slipped in' },
  { key: 'citation_accuracy', label: 'Citation accuracy', reason: 'more findings failed citation grounding' },
] as const;

/** Banner text for the largest metric drop >= 2 points, else null. */
export function buildAlert(latest: AlertMetrics, previous: AlertMetrics): string | null {
  let best: { label: string; reason: string; drop: number } | null = null;
  for (const m of ALERT_METRICS) {
    const cur = latest[m.key];
    const prev = previous[m.key];
    if (cur === null || prev === null) continue;
    // Round to avoid float noise (0.87 - 0.85 = 0.0199999...) at the 2.0 boundary.
    const drop = Math.round((prev - cur) * 100 * 1e6) / 1e6;
    if (drop < ALERT_DROP_PTS) continue;
    if (best === null || drop > best.drop) best = { label: m.label, reason: m.reason, drop };
  }
  if (!best) return null;
  const pts = Number.isInteger(best.drop) ? String(best.drop) : best.drop.toFixed(1);
  return `${best.label} dipped ${pts} pts on v${latest.agent_version} — ${best.reason}`;
}

/** Line-based LCS diff of two texts. */
export function promptDiff(oldText: string, newText: string): EvalCompare['prompt_diff'] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: EvalCompare['prompt_diff'] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ op: 'del', text: a[i]! });
      i++;
    } else {
      out.push({ op: 'add', text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ op: 'del', text: a[i++]! });
  while (j < m) out.push({ op: 'add', text: b[j++]! });
  return out;
}

export interface CompareMetrics {
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  cost_usd: number | null;
}

/** head − base per metric; null when either side is null. */
export function compareDelta(base: CompareMetrics, head: CompareMetrics): EvalCompare['delta'] {
  const d = (h: number | null, b: number | null) => (h === null || b === null ? null : h - b);
  return {
    recall: d(head.recall, base.recall),
    precision: d(head.precision, base.precision),
    citation_accuracy: d(head.citation_accuracy, base.citation_accuracy),
    cost_usd: d(head.cost_usd, base.cost_usd),
  };
}

/** A running batch older than 30 min that this process isn't executing or queueing. */
export function isStaleBatch(
  batch: { id: string; status: string; startedAt: Date },
  now: Date,
  liveIds: ReadonlySet<string> | readonly string[],
): boolean {
  if (batch.status !== 'running') return false;
  if (now.getTime() - batch.startedAt.getTime() <= STALE_BATCH_MS) return false;
  const live = liveIds instanceof Set ? liveIds.has(batch.id) : (liveIds as readonly string[]).includes(batch.id);
  return !live;
}
