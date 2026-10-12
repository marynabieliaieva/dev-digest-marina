import { describe, it, expect } from 'vitest';
import { AppError, ConfigError, ExternalServiceError } from '../src/platform/errors.js';
import { buildDataGaps, toBriefFailure, type GapFacts } from '../src/modules/brief/helpers.js';

const reasonOf = (e: AppError) => (e.details as { reason: string }).reason;

describe('toBriefFailure', () => {
  it('maps ConfigError at model_resolve to missing_key', () => {
    const e = toBriefFailure(new ConfigError('OPENAI_API_KEY is not configured'), 'model_resolve');
    expect(e.statusCode).toBe(502);
    expect(e.code).toBe('brief_generation_failed');
    expect(reasonOf(e)).toBe('missing_key');
  });

  it('maps ConfigError at model_call to provider_error', () => {
    expect(reasonOf(toBriefFailure(new ConfigError('GITHUB_TOKEN is not configured'), 'model_call'))).toBe(
      'provider_error',
    );
  });

  it('maps schema-validation failures (adapter and OpenRouter shapes) to schema_invalid', () => {
    const a = toBriefFailure(
      new ExternalServiceError('OpenAI structured output failed schema validation'),
      'model_call',
    );
    const b = toBriefFailure(
      new Error('OpenRouter structured output failed schema validation for PrBriefGeneration'),
      'model_call',
    );
    expect(reasonOf(a)).toBe('schema_invalid');
    expect(reasonOf(b)).toBe('schema_invalid');
  });

  it('scrubs secrets from the message', () => {
    const e = toBriefFailure(new Error('401 Bearer sk-test-123 sk-abc_def'), 'model_call');
    expect(e.message).not.toContain('sk-');
    expect(reasonOf(e)).toBe('provider_error');
  });
});

describe('buildDataGaps', () => {
  const ok: GapFacts = {
    prBody: 'body',
    intent: { status: 'ready', stale: false },
    blast: { degraded: false, reason: null },
    linkedIssue: { hasLink: true, fetched: true },
    specs: { clone: true, docs: [{ status: 'ok' }] },
  };

  it('reports no gaps when everything is present', () => {
    expect(buildDataGaps(ok)).toEqual([]);
  });

  it('intent: missing row, failed, stale', () => {
    expect(buildDataGaps({ ...ok, intent: null })).toContainEqual(expect.objectContaining({ source: 'intent', status: 'missing' }));
    expect(buildDataGaps({ ...ok, intent: { status: 'failed', stale: false } })).toContainEqual(
      expect.objectContaining({ source: 'intent', status: 'missing' }),
    );
    expect(buildDataGaps({ ...ok, intent: { status: 'ready', stale: true } })).toContainEqual(
      expect.objectContaining({ source: 'intent', status: 'stale' }),
    );
  });

  it('pr_description, blast, linked issue and specs gaps', () => {
    expect(buildDataGaps({ ...ok, prBody: '  ' })).toContainEqual(
      expect.objectContaining({ source: 'pr_description', status: 'missing' }),
    );
    expect(buildDataGaps({ ...ok, blast: null })).toContainEqual(
      expect.objectContaining({ source: 'blast_radius', status: 'missing' }),
    );
    expect(buildDataGaps({ ...ok, blast: { degraded: true, reason: 'flag_off' } })).toContainEqual(
      expect.objectContaining({ source: 'blast_radius', status: 'degraded' }),
    );
    expect(buildDataGaps({ ...ok, linkedIssue: { hasLink: false, fetched: false } })).toContainEqual(
      expect.objectContaining({ source: 'linked_issue', status: 'missing' }),
    );
    expect(buildDataGaps({ ...ok, linkedIssue: { hasLink: true, fetched: false } })).toContainEqual(
      expect.objectContaining({ source: 'linked_issue', status: 'missing' }),
    );
    expect(buildDataGaps({ ...ok, specs: { clone: false, docs: [] } })).toContainEqual(
      expect.objectContaining({ source: 'specs', status: 'missing' }),
    );
    expect(buildDataGaps({ ...ok, specs: { clone: true, docs: [] } })).toContainEqual(
      expect.objectContaining({ source: 'specs', status: 'missing' }),
    );
  });
});
