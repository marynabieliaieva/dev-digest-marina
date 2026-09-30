import type { IntentSourceKind, PrIntentRecord, PromptSectionStat } from '@devdigest/shared';
import type { IntentRow } from './repository.js';
import { AUTH_REQUIRED_HOSTS, DOC_DIR_PATTERN, MAX_LINKS, MAX_REASON_CHARS, MAX_SKIPPED_RECORDED } from './constants.js';

/** Pure helpers for the intent module: link extraction, redaction, log formatting, DTO mapping. */

// ---------------------------------------------------------------- redaction

const SECRET_PATTERNS: [RegExp, string][] = [
  [/Authorization\s*[:=]\s*(?:Bearer\s+|Basic\s+|token\s+)?[^\s,;'"]+/gi, 'Authorization: [REDACTED]'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'],
  [/github_pat_[A-Za-z0-9_]+/g, '[REDACTED]'],
  [/\bgh[pousr]_[A-Za-z0-9]+/g, '[REDACTED]'],
  // sk-..., sk-or-v1-..., sk-ant-...
  [/\bsk-[A-Za-z0-9_-]+/g, '[REDACTED]'],
  [/\b(api[_-]?key|access[_-]?token|token|secret|password)\s*[=:]\s*[^\s,;'"&]+/gi, '$1=[REDACTED]'],
];

/** Replace well-known credential shapes with `[REDACTED]`. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Drop query string, fragment and userinfo from a URL (signed URLs are credentials). */
export function stripUrlQuery(url: string): string {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    u.username = '';
    u.password = '';
    return u.toString();
  } catch {
    return url.split(/[?#]/)[0] ?? '';
  }
}

/** Redact secrets and strip query strings of any URL embedded in free text (errors, reasons). */
export function scrubText(text: string, max = MAX_REASON_CHARS): string {
  const noQuery = text.replace(/https?:\/\/[^\s"'<>)\]]+/gi, (m) => stripUrlQuery(m));
  return redactSecrets(noQuery).slice(0, max);
}

/** Query-less, secret-free ref suitable for persisting/logging. */
export function safeRef(ref: string): string {
  // Only URLs carry query/fragment; `#12` and repo paths are kept verbatim.
  return redactSecrets(/^https?:\/\//i.test(ref) ? stripUrlQuery(ref) : ref);
}

// ---------------------------------------------------------- link extraction

export type LinkTarget =
  | { type: 'issue'; number: number }
  | { type: 'repo_file'; path: string; gitRef: string | null }
  | { type: 'url'; url: string }
  | { type: 'unsupported'; reason: string };

export interface IntentLink {
  kind: Extract<IntentSourceKind, 'linked_issue' | 'repo_doc' | 'external_doc'>;
  /** Display/persist ref: `#12`, a repo-relative path, or a query-less URL. */
  ref: string;
  target: LinkTarget;
  /** True when the link exceeded MAX_LINKS — recorded but never fetched. */
  skipped: boolean;
}

const SAME_REPO = (a: { owner: string; name: string }, owner: string, name: string) =>
  a.owner.toLowerCase() === owner.toLowerCase() && a.name.toLowerCase() === name.toLowerCase();

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

function classifyUrl(raw: string, repo: { owner: string; name: string }): Omit<IntentLink, 'skipped'> {
  const ref = safeRef(raw);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { kind: 'external_doc', ref, target: { type: 'unsupported', reason: 'invalid URL' } };
  }
  const host = u.hostname.toLowerCase();

  if (host === 'github.com' || host === 'www.github.com') {
    const seg = u.pathname.split('/').filter(Boolean);
    const [owner, name, type, ...rest] = seg;
    if (owner && name && (type === 'issues' || type === 'pull') && rest[0] && /^\d+$/.test(rest[0])) {
      if (!SAME_REPO(repo, owner, name)) {
        return { kind: 'linked_issue', ref, target: { type: 'unsupported', reason: 'link points to another repository' } };
      }
      return { kind: 'linked_issue', ref: `#${rest[0]}`, target: { type: 'issue', number: Number(rest[0]) } };
    }
    if (owner && name && type === 'blob' && rest.length >= 2) {
      if (!SAME_REPO(repo, owner, name)) {
        return { kind: 'repo_doc', ref, target: { type: 'unsupported', reason: 'link points to another repository' } };
      }
      const [gitRef, ...pathParts] = rest;
      const path = decodeURIComponent(pathParts.join('/'));
      if (path.split('/').includes('..')) {
        return { kind: 'repo_doc', ref, target: { type: 'unsupported', reason: 'invalid path' } };
      }
      return { kind: 'repo_doc', ref: path, target: { type: 'repo_file', path, gitRef: gitRef! } };
    }
    return { kind: 'external_doc', ref, target: { type: 'unsupported', reason: 'unsupported GitHub URL' } };
  }

  if (u.protocol !== 'https:') {
    return { kind: 'external_doc', ref, target: { type: 'unsupported', reason: 'https only' } };
  }
  if (AUTH_REQUIRED_HOSTS.some((h) => hostMatches(host, h))) {
    return {
      kind: 'external_doc',
      ref,
      target: { type: 'unsupported', reason: 'requires authenticated integration' },
    };
  }
  return { kind: 'external_doc', ref, target: { type: 'url', url: u.toString() } };
}

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/gi;
const ISSUE_RE = /(?<![\w&/#])(?:(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)\s+)?#(\d{1,7})\b/gi;
const DOC_PATH_RE = new RegExp(
  `(?<![\\w/.:-])((?:[\\w.-]+/)*${DOC_DIR_PATTERN}/(?:[\\w.-]+/)*[\\w.-]+\\.(?:md|mdx|txt))(?![\\w-])`,
  'gi',
);

/**
 * Find plan/spec/ticket links in a PR body, in body order, deduplicated. The
 * first MAX_LINKS are returned live; up to MAX_SKIPPED_RECORDED more are
 * returned with `skipped: true`. Never fetches anything.
 */
export function extractIntentLinks(body: string, repo: { owner: string; name: string }): IntentLink[] {
  const found: { index: number; link: Omit<IntentLink, 'skipped'> }[] = [];

  for (const m of body.matchAll(URL_RE)) {
    const trimmed = m[0].replace(/[.,;:!?]+$/, '');
    found.push({ index: m.index!, link: classifyUrl(trimmed, repo) });
  }
  // Mask URLs so `#frag` / `/docs/x.md` inside them are not re-matched.
  const masked = body.replace(URL_RE, (m) => ' '.repeat(m.length));

  for (const m of masked.matchAll(ISSUE_RE)) {
    const n = Number(m[1]);
    found.push({
      index: m.index!,
      link: { kind: 'linked_issue', ref: `#${n}`, target: { type: 'issue', number: n } },
    });
  }
  for (const m of masked.matchAll(DOC_PATH_RE)) {
    const path = m[1]!.replace(/^\.\//, '');
    const link: Omit<IntentLink, 'skipped'> = path.split('/').includes('..')
      ? { kind: 'repo_doc', ref: path, target: { type: 'unsupported', reason: 'invalid path' } }
      : { kind: 'repo_doc', ref: path, target: { type: 'repo_file', path, gitRef: null } };
    found.push({ index: m.index!, link });
  }

  found.sort((a, b) => a.index - b.index);

  const seen = new Set<string>();
  const out: IntentLink[] = [];
  for (const { link } of found) {
    const key = `${link.kind}:${link.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (out.length >= MAX_LINKS + MAX_SKIPPED_RECORDED) break;
    out.push({ ...link, skipped: out.length >= MAX_LINKS });
  }
  return out;
}

// ------------------------------------------------------------------ logging

/** Sink the service logs through: RunLogger in the review path, an adapter over `req.log` in routes. */
export interface IntentLog {
  info(msg: string, data?: unknown): void;
  tool(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

type PinoLog = {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

/** Adapt a pino-style logger (`(obj, msg)`) to `IntentLog`. */
export function pinoIntentLog(log: PinoLog): IntentLog {
  const emit = (fn: PinoLog['info'], msg: string, data?: unknown) =>
    fn(data !== undefined ? { data } : {}, msg);
  return {
    info: (m, d) => emit(log.info.bind(log), m, d),
    tool: (m, d) => emit(log.info.bind(log), m, d),
    error: (m, d) => emit(log.error.bind(log), m, d),
  };
}

/** `<prefix> — provider=<p> model=<m> sections=[name:Nc, …] ~<tok> tok` (stats only, never content). */
export function formatCompositionMsg(
  prefix: string,
  provider: string,
  model: string,
  stats: PromptSectionStat[],
): string {
  const sections = stats.map((s) => `${s.name}:${s.chars}c`).join(', ');
  const tok = stats.reduce((n, s) => n + s.est_tokens, 0);
  return `${prefix} — provider=${provider} model=${model} sections=[${sections}] ~${tok} tok`;
}

export const sha7 = (sha: string | null | undefined): string => (sha ? sha.slice(0, 7) : 'unknown');

// ------------------------------------------------------------------ mapping

/** Row → API record. `stale` when the row has no head sha or it differs from the PR's current head. */
export function toPrIntentRecord(row: IntentRow, currentHeadSha: string): PrIntentRecord {
  return {
    pr_id: row.prId,
    summary: row.summary,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    risk_areas: row.riskAreas,
    confidence: row.confidence,
    missing_context: row.missingContext,
    sources: row.sources,
    status: row.status,
    error: row.error,
    head_sha: row.headSha,
    stale: row.headSha === null || row.headSha !== currentHeadSha,
    provider: row.provider,
    model: row.model,
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    cost_usd: row.costUsd,
    derived_at: row.derivedAt.toISOString(),
    composition: row.composition,
  };
}
