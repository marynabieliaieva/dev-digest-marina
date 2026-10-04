import { describe, it, expect } from 'vitest';
import {
  Finding,
  FEATURE_MODELS,
  Intent,
  IntentClassification,
  IntentSource,
  PrIntentResponse,
} from '@devdigest/shared';

const classification = {
  summary: 'Adds rate limiting to the public API.',
  in_scope: ['rate limiter middleware'],
  out_of_scope: ['auth refactor'],
  risk_areas: ['latency'],
  confidence: 'medium',
  missing_context: [],
};

const source = {
  kind: 'pr_body',
  ref: 'pr_body',
  status: 'used',
  chars: 10,
  sha256: null,
  reason: null,
};

const baseFinding = {
  id: 'f1',
  severity: 'WARNING',
  category: 'bug',
  title: 'Off by one',
  file: 'src/a.ts',
  start_line: 1,
  end_line: 2,
  rationale: 'because',
  confidence: 0.7,
};

describe('intent contracts', () => {
  it('IntentClassification parses a full object and rejects a missing confidence', () => {
    expect(() => IntentClassification.parse(classification)).not.toThrow();
    const { confidence: _c, ...rest } = classification;
    expect(IntentClassification.safeParse(rest).success).toBe(false);
  });

  it('Intent requires sources', () => {
    expect(Intent.safeParse(classification).success).toBe(false);
    expect(Intent.safeParse({ ...classification, sources: [source] }).success).toBe(true);
  });

  it('IntentSource rejects an unknown status', () => {
    expect(IntentSource.safeParse({ ...source, status: 'invented' }).success).toBe(false);
  });

  it('Finding parses without scope and accepts scope', () => {
    expect(Finding.safeParse(baseFinding).success).toBe(true);
    expect(Finding.safeParse({ ...baseFinding, scope: 'out_of_scope' }).success).toBe(true);
    expect(Finding.safeParse({ ...baseFinding, scope: 'nope' }).success).toBe(false);
  });

  it('PrIntentResponse accepts intent: null', () => {
    expect(
      PrIntentResponse.safeParse({ pr_id: 'p', current_head_sha: 'abc', intent: null }).success,
    ).toBe(true);
  });

  it('review_intent defaults to an OpenRouter model', () => {
    const def = FEATURE_MODELS.find((f) => f.id === 'review_intent');
    expect(def?.defaultProvider).toBe('openrouter');
    expect(def?.defaultModel).toBe('deepseek/deepseek-v4-flash');
  });
});
