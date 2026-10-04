import type { Finding, Severity } from '@devdigest/shared';

/**
 * Scope filter: drops findings the model marked `out_of_scope` relative to the
 * derived intent, but always leaves ONE signal for a serious one.
 *
 * Deliberately conservative — over-suppression would hide real defects:
 *  - secret_leak / lethal_trifecta findings are never suppressed;
 *  - "serious" means severity CRITICAL only (a security WARNING does not qualify);
 *  - `scope` null/absent/in_scope is always kept.
 */

export interface ScopeFilterResult {
  kept: Finding[];
  suppressed: { finding: Finding; reason: string }[];
  /** The single serious out-of-scope finding that was kept (re-titled), if any. */
  signal: Finding | null;
}

const NEVER_SUPPRESSED = new Set(['secret_leak', 'lethal_trifecta']);
const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };

export function applyIntentScope(
  findings: Finding[],
  opts: { enabled: boolean },
): ScopeFilterResult {
  if (!opts.enabled) return { kept: [...findings], suppressed: [], signal: null };

  const isCandidate = (f: Finding) =>
    f.scope === 'out_of_scope' && !(f.kind != null && NEVER_SUPPRESSED.has(f.kind));
  const candidates = findings.filter(isCandidate);

  let best: Finding | null = null;
  for (const f of candidates) {
    if (f.severity !== 'CRITICAL') continue;
    if (
      best === null ||
      SEVERITY_RANK[f.severity] > SEVERITY_RANK[best.severity] ||
      (SEVERITY_RANK[f.severity] === SEVERITY_RANK[best.severity] && f.confidence > best.confidence)
    ) {
      best = f; // strict > keeps the earliest on ties (original order)
    }
  }

  const othersCount = candidates.length - (best ? 1 : 0);
  let signal: Finding | null = null;
  if (best) {
    signal = {
      ...best,
      title: `[Out of scope] ${best.title}`,
      rationale:
        `${best.rationale}\n\n_Outside this PR's stated scope; ` +
        `${othersCount} other out-of-scope finding(s) suppressed._`,
    };
  }

  const kept: Finding[] = [];
  const suppressed: { finding: Finding; reason: string }[] = [];
  for (const f of findings) {
    if (f === best && signal) kept.push(signal);
    else if (isCandidate(f)) {
      suppressed.push({ finding: f, reason: 'out of scope for the derived PR intent' });
    } else kept.push(f);
  }
  return { kept, suppressed, signal };
}
