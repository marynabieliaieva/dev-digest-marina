import { describe, it, expect } from 'vitest';
import {
  extractIntentLinks,
  formatCompositionMsg,
  pinoIntentLog,
  redactSecrets,
  scrubText,
  stripUrlQuery,
  toPrIntentRecord,
} from '../src/modules/intent/helpers.js';
import type { IntentRow } from '../src/modules/intent/repository.js';
import { loadConfig } from '../src/platform/config.js';

const REPO = { owner: 'acme', name: 'widgets' };

const BODY = [
  'Fixes #12',
  'Plan: docs/plans/foo.md',
  'Spec: https://github.com/acme/widgets/blob/main/docs/spec.md',
  'Related: https://github.com/other/repo/issues/3',
  'Ticket: https://acme.atlassian.net/browse/ABC-1?token=x',
  'Old: http://example.com/a.md',
  'Doc: https://example.com/b.md',
  'https://example.com/c.md?sig=secret#frag',
  'https://example.com/d.md',
].join('\n');

describe('extractIntentLinks', () => {
  const links = extractIntentLinks(BODY, REPO);

  it('classifies in body order', () => {
    expect(links.slice(0, 6).map((l) => l.kind)).toEqual([
      'linked_issue',
      'repo_doc',
      'repo_doc',
      'linked_issue',
      'external_doc',
      'external_doc',
    ]);
    expect(links[0]!.target).toEqual({ type: 'issue', number: 12 });
    expect(links[1]!.ref).toBe('docs/plans/foo.md');
    expect(links[2]!.ref).toBe('docs/spec.md');
    expect(links[2]!.target).toEqual({ type: 'repo_file', path: 'docs/spec.md', gitRef: 'main' });
  });

  it('marks cross-repo, auth-host and http links unsupported', () => {
    expect(links[3]!.target).toMatchObject({ type: 'unsupported' });
    expect(links[4]!.target).toMatchObject({ type: 'unsupported', reason: 'requires authenticated integration' });
    expect(links[5]!.target).toMatchObject({ type: 'unsupported', reason: 'https only' });
  });

  it('keeps exactly 5 live entries and flags the rest skipped', () => {
    expect(links.filter((l) => !l.skipped)).toHaveLength(5);
    expect(links.filter((l) => l.skipped)).toHaveLength(links.length - 5);
    expect(links.length).toBe(9);
  });

  it('never leaves a query string or fragment in a ref (except the #12 issue form)', () => {
    for (const l of links) {
      if (l.kind === 'linked_issue' && l.target.type === 'issue') continue;
      expect(l.ref).not.toMatch(/[?#]/);
    }
  });

  it('dedupes and rejects path traversal', () => {
    const l = extractIntentLinks('#5 #5 fixes #5 see ../docs/secret.md and docs/plans/a.md docs/plans/a.md', REPO);
    expect(l.filter((x) => x.kind === 'linked_issue')).toHaveLength(1);
    const traversal = l.find((x) => x.ref.includes('..'));
    expect(traversal?.target).toMatchObject({ type: 'unsupported' });
    expect(l.filter((x) => x.ref === 'docs/plans/a.md')).toHaveLength(1);
  });

  it('does not treat a URL fragment as an issue reference', () => {
    expect(extractIntentLinks('see https://example.com/page#12', REPO).map((l) => l.kind)).toEqual(['external_doc']);
  });
});

describe('redaction', () => {
  it('redacts tokens and bearer values', () => {
    const out = redactSecrets('401 Bearer sk-or-v1-abc123 ghp_XYZ github_pat_11AA sk-ant-zzz');
    for (const s of ['sk-or-v1-abc123', 'ghp_XYZ', 'github_pat_11AA', 'sk-ant-zzz']) expect(out).not.toContain(s);
    expect(out).toContain('[REDACTED]');
  });

  it('redacts Authorization header values', () => {
    expect(redactSecrets('Authorization: Bearer abc.def')).not.toContain('abc.def');
  });

  it('strips query, fragment and credentials from URLs', () => {
    expect(stripUrlQuery('https://u:p@example.com/a.md?token=x#h')).toBe('https://example.com/a.md');
    expect(stripUrlQuery('not a url?x=1')).toBe('not a url');
  });

  it('scrubs URLs embedded in error text', () => {
    const out = scrubText('Could not fetch https://example.com/a.md?token=sekret: TypeError');
    expect(out).not.toContain('sekret');
    expect(out).toContain('https://example.com/a.md');
  });
});

describe('formatCompositionMsg / pinoIntentLog', () => {
  it('formats stats only', () => {
    const msg = formatCompositionMsg('intent: classifier request', 'openrouter', 'm/x', [
      { name: 'pr_title', chars: 52, est_tokens: 13, sha256: 'a'.repeat(64) },
      { name: 'pr_body', chars: 0, est_tokens: 0, sha256: 'b'.repeat(64) },
    ]);
    expect(msg).toBe('intent: classifier request — provider=openrouter model=m/x sections=[pr_title:52c, pr_body:0c] ~13 tok');
  });

  it('adapts a pino-style logger', () => {
    const seen: [unknown, string | undefined][] = [];
    const log = pinoIntentLog({
      info: (o, m) => seen.push([o, m]),
      error: (o, m) => seen.push([o, m]),
    });
    log.tool('hello', { a: 1 });
    expect(seen).toEqual([[{ data: { a: 1 } }, 'hello']]);
  });
});

describe('toPrIntentRecord', () => {
  const row: IntentRow = {
    prId: 'p1',
    summary: 's',
    inScope: ['a'],
    outOfScope: [],
    riskAreas: [],
    confidence: 'medium',
    missingContext: [],
    sources: [],
    composition: [],
    status: 'ready',
    error: null,
    headSha: 'abc',
    provider: 'openrouter',
    model: 'm',
    tokensIn: 1,
    tokensOut: 2,
    costUsd: null,
    derivedAt: new Date('2026-01-01T00:00:00Z'),
  };
  it('is stale for a mismatched sha and for a null sha, fresh when equal', () => {
    expect(toPrIntentRecord(row, 'def').stale).toBe(true);
    expect(toPrIntentRecord({ ...row, headSha: null }, 'abc').stale).toBe(true);
    expect(toPrIntentRecord(row, 'abc').stale).toBe(false);
  });
  it('keeps cost null (unknown) and maps summary', () => {
    const rec = toPrIntentRecord(row, 'abc');
    expect(rec.cost_usd).toBeNull();
    expect(rec.summary).toBe('s');
    expect(rec.derived_at).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('config.intentExternalFetch', () => {
  it('defaults ON and turns off only for "false"', () => {
    expect(loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv).intentExternalFetch).toBe(true);
    expect(loadConfig({ NODE_ENV: 'test', INTENT_EXTERNAL_FETCH: 'false' } as NodeJS.ProcessEnv).intentExternalFetch).toBe(false);
    expect(loadConfig({ NODE_ENV: 'test', INTENT_EXTERNAL_FETCH: 'true' } as NodeJS.ProcessEnv).intentExternalFetch).toBe(true);
  });
});
