import { describe, it, expect } from 'vitest';
import type { PrBriefGeneration, Risk } from '@devdigest/shared';
import { validateBriefOutput, type BriefValidationInput } from '../src/index.js';

const input = (over: Partial<BriefValidationInput> = {}): BriefValidationInput => ({
  prFiles: new Map([['src/a.ts', [[10, 20] as [number, number]]]]),
  blastFiles: new Set<string>(),
  callerLines: new Map(),
  ...over,
});

const risk = (over: Partial<Risk> = {}): Risk => ({
  kind: 'k',
  title: 't',
  explanation: 'e',
  severity: 'low',
  file_refs: ['src/a.ts'],
  ...over,
});

const out = (over: Partial<PrBriefGeneration>): PrBriefGeneration => ({
  summary: 'sum',
  risks: [],
  review_focus: [],
  ...over,
});

describe('validateBriefOutput', () => {
  it('applies the AC-23 example', () => {
    const r = validateBriefOutput(
      out({
        risks: [risk({ file_refs: ['src/ghost.ts'] })],
        review_focus: [
          { file: 'src/a.ts', line: 999, reason: 'x' },
          { file: './src/a.ts', line: 12, reason: 'y' },
        ],
      }),
      input(),
    );
    expect(r.risks).toEqual([]);
    expect(r.review_focus).toEqual([{ file: 'src/a.ts', line: 12, reason: 'y' }]);
    expect(r.dropped).toEqual({ risks: 1, risk_file_refs: 1, review_focus: 1 });
  });

  it('sorts risks by severity (stable) and caps at 8', () => {
    const risks = Array.from({ length: 10 }, (_, i) =>
      risk({ title: `r${i}`, severity: (['low', 'high', 'medium'] as const)[i % 3]! }),
    );
    const r = validateBriefOutput(out({ risks }), input());
    expect(r.risks).toHaveLength(8);
    const sev = r.risks.map((x) => x.severity);
    expect(sev).toEqual([...sev].sort((a, b) => ['high', 'medium', 'low'].indexOf(a) - ['high', 'medium', 'low'].indexOf(b)));
    expect(r.risks.filter((x) => x.severity === 'high').map((x) => x.title)).toEqual(['r1', 'r4', 'r7']);
    expect(r.dropped.risks).toBe(2);
  });

  it('caps focus items at 6', () => {
    const review_focus = Array.from({ length: 9 }, () => ({ file: 'src/a.ts', line: 11, reason: 'r' }));
    const r = validateBriefOutput(out({ review_focus }), input());
    expect(r.review_focus).toHaveLength(6);
    expect(r.dropped.review_focus).toBe(3);
  });

  it('keeps a blast-only file with a caller line', () => {
    const r = validateBriefOutput(
      out({ review_focus: [{ file: 'src/b.ts', line: 5, reason: 'caller' }] }),
      input({ blastFiles: new Set(['src/b.ts']), callerLines: new Map([['src/b.ts', new Set([5])]]) }),
    );
    expect(r.review_focus).toHaveLength(1);
  });

  it('drops a focus item on a pure-deletion file', () => {
    const r = validateBriefOutput(
      out({ review_focus: [{ file: 'src/d.ts', line: 1, reason: 'x' }] }),
      input({ prFiles: new Map([['src/d.ts', []]]) }),
    );
    expect(r.review_focus).toEqual([]);
  });

  it('returns the summary with empty lists when everything is invalid', () => {
    const r = validateBriefOutput(
      out({
        risks: [risk({ file_refs: ['nope.ts'] })],
        review_focus: [{ file: 'nope.ts', line: 1, reason: 'x' }],
      }),
      input(),
    );
    expect(r).toMatchObject({ summary: 'sum', risks: [], review_focus: [] });
  });
});
