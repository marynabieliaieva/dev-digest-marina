import { describe, it, expect } from 'vitest';
import { PrBrief, PrBriefGeneration, PrBriefRequest, ReviewFocusItem } from '@devdigest/shared';

const fixture = {
  intent: null,
  blast: null,
  risks: { risks: [] },
  history: { history: [] },
  summary: 's',
  review_focus: [{ file: 'src/a.ts', line: 12, reason: 'x' }],
  head_sha: 'a1b2c3d4e5f6',
  generated_at: '2026-10-10T00:00:00Z',
  provider: 'openai',
  model: 'm',
  tokens_in: 1,
  tokens_out: 2,
  cost_usd: null,
  attempts: 1,
  data_gaps: [],
  inputs: [],
  dropped: { risks: 0, risk_file_refs: 0, review_focus: 0 },
};

describe('brief contracts', () => {
  it('parses a valid PrBrief', () => {
    expect(PrBrief.parse(fixture).intent).toBeNull();
  });

  it('rejects a PrBrief without head_sha', () => {
    const { head_sha: _h, ...rest } = fixture;
    expect(() => PrBrief.parse(rest)).toThrow();
  });

  it('rejects non-positive or fractional lines', () => {
    expect(ReviewFocusItem.safeParse({ file: 'a', line: 0, reason: 'x' }).success).toBe(false);
    expect(ReviewFocusItem.safeParse({ file: 'a', line: 1.5, reason: 'x' }).success).toBe(false);
  });

  it('requires review_focus in PrBriefGeneration', () => {
    expect(PrBriefGeneration.safeParse({ summary: 's', risks: [] }).success).toBe(false);
  });

  it('defaults request mode to refresh', () => {
    expect(PrBriefRequest.parse({})).toEqual({ mode: 'refresh' });
  });
});
