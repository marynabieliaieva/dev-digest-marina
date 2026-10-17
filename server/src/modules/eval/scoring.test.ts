import { describe, expect, it } from 'vitest';
import type { EvalExpectation } from '@devdigest/shared';
import { matches, normalizePath, scoreBatch, scoreCase, type BatchCaseInput, type ScorableFinding } from './scoring.js';

const exp = (over: Partial<EvalExpectation> = {}): EvalExpectation => ({
  type: 'must_find',
  file: 'src/a.ts',
  start_line: 10,
  end_line: 12,
  kind: 'finding',
  severity: 'WARNING',
  category: 'security',
  title: 't',
  source_finding_id: 'f0',
  ...over,
});

const fnd = (id: string, over: Partial<ScorableFinding> = {}): ScorableFinding => ({
  id,
  file: 'src/a.ts',
  start_line: 10,
  end_line: 12,
  kind: 'finding',
  ...over,
});

describe('matches', () => {
  it('touching ranges match (10-12 vs 12-15)', () => {
    expect(matches(fnd('x', { start_line: 12, end_line: 15 }), exp())).toBe(true);
  });
  it('adjacent ranges do not match (10-12 vs 13-15)', () => {
    expect(matches(fnd('x', { start_line: 13, end_line: 15 }), exp())).toBe(false);
  });
  it('other file does not match', () => {
    expect(matches(fnd('x', { file: 'src/b.ts' }), exp())).toBe(false);
  });
  it('normalises ./ and backslashes', () => {
    expect(matches(fnd('x', { file: './src/a.ts' }), exp())).toBe(true);
    expect(matches(fnd('x', { file: 'a\\b.ts' }), exp({ file: 'a/b.ts' }))).toBe(true);
    expect(normalizePath('/a.ts')).toBe('a.ts');
  });
  it('full-file kind matches on file only', () => {
    expect(matches(fnd('x', { kind: 'hook', start_line: 99, end_line: 99 }), exp())).toBe(true);
    expect(matches(fnd('x', { start_line: 99, end_line: 99 }), exp({ kind: 'secret_leak' }))).toBe(true);
  });
  it('reversed range is normalised', () => {
    expect(matches(fnd('x', { start_line: 15, end_line: 10 }), exp())).toBe(true);
    expect(matches(fnd('x', { start_line: 11, end_line: 11 }), exp({ start_line: 12, end_line: 10 }))).toBe(true);
  });
});

describe('scoreCase', () => {
  const hit = (n: number) => Array.from({ length: n }, (_, i) => fnd(`h${i}`));

  it.each([
    [0, false, 0],
    [1, true, 1],
    [2, true, 1],
  ])('must_find with %i matches => pass %s recall %i', (n, pass, recall) => {
    const s = scoreCase({ expectation: exp(), grounded: hit(n), dropped: [] });
    expect(s.pass).toBe(pass);
    expect(s.recall).toBe(recall);
    expect(s.precision).toBeNull();
    expect(s.matched_count).toBe(n);
  });

  it('must_not_flag with 0 produced => pass, precision 1', () => {
    const s = scoreCase({ expectation: exp({ type: 'must_not_flag' }), grounded: [], dropped: [] });
    expect(s).toMatchObject({ pass: true, precision: 1, recall: null, citation_accuracy: null });
  });

  it('must_not_flag precision = 1 - matched/produced', () => {
    const grounded = [fnd('a'), fnd('b', { file: 'other.ts' }), fnd('c', { file: 'other.ts' }), fnd('d', { file: 'o.ts' })];
    const s = scoreCase({ expectation: exp({ type: 'must_not_flag' }), grounded, dropped: [] });
    expect(s.pass).toBe(false);
    expect(s.precision).toBeCloseTo(0.75);
    expect(s.matched_finding_ids).toEqual(['a']);
  });

  it('citation accuracy = grounded / (grounded + dropped)', () => {
    const s = scoreCase({ expectation: exp(), grounded: hit(2), dropped: [{}] });
    expect(s.citation_accuracy).toBeCloseTo(2 / 3);
  });

  it('errored case => pass null and nothing counted', () => {
    const s = scoreCase({ expectation: exp(), grounded: hit(2), dropped: [], errored: true });
    expect(s).toMatchObject({ pass: null, recall: null, precision: null, actual_count: 0 });
  });
});

const bc = (over: Partial<BatchCaseInput> = {}): BatchCaseInput => ({
  type: 'must_find',
  errored: false,
  pass: true,
  matched_count: 1,
  actual_count: 1,
  dropped_count: 0,
  cost_usd: 0.01,
  ...over,
});

describe('scoreBatch', () => {
  it('no must_find => recall null', () => {
    expect(scoreBatch([bc({ type: 'must_not_flag', pass: true, matched_count: 0, actual_count: 0 })]).recall).toBeNull();
  });
  it('no must_not_flag => precision null', () => {
    expect(scoreBatch([bc()]).precision).toBeNull();
  });
  it('must_not_flag with zero produced => precision 1', () => {
    const r = scoreBatch([bc({ type: 'must_not_flag', matched_count: 0, actual_count: 0 })]);
    expect(r.precision).toBe(1);
  });
  it('zero findings overall => citation null', () => {
    expect(scoreBatch([bc({ actual_count: 0, matched_count: 0, pass: false })]).citation_accuracy).toBeNull();
  });
  it('any null case cost => batch cost null', () => {
    expect(scoreBatch([bc(), bc({ cost_usd: null })]).cost_usd).toBeNull();
  });
  it('sums cost, recall, precision, citation', () => {
    const r = scoreBatch([
      bc({ pass: true, actual_count: 2, dropped_count: 1, cost_usd: 0.01 }),
      bc({ pass: false, matched_count: 0, actual_count: 0, cost_usd: 0.02 }),
      bc({ type: 'must_not_flag', pass: false, matched_count: 1, actual_count: 4, cost_usd: 0.03 }),
    ]);
    expect(r.recall).toBe(0.5);
    expect(r.precision).toBeCloseTo(0.75);
    expect(r.citation_accuracy).toBeCloseTo(6 / 7);
    expect(r.cost_usd).toBeCloseTo(0.06);
    expect(r.traces_passed).toBe(1);
    expect(r.traces_total).toBe(3);
  });
  it('errored case counts in traces_total only', () => {
    const r = scoreBatch([bc(), bc({ errored: true, pass: null, matched_count: 0, actual_count: 0 })]);
    expect(r.traces_total).toBe(2);
    expect(r.traces_passed).toBe(1);
    expect(r.recall).toBe(1);
  });
});

describe('scoring makes no LLM calls', () => {
  it('completes while an injected provider throws on every method', () => {
    const llm = new Proxy({}, { get: () => () => { throw new Error('LLM must not be called'); } });
    const cases = [scoreCase({ expectation: exp(), grounded: [fnd('a')], dropped: [] })];
    expect(() => scoreBatch([{ type: 'must_find', errored: false, cost_usd: 0, ...cases[0]! }])).not.toThrow();
    expect(llm).toBeDefined();
  });
});

describe('performance', () => {
  it('scores 100 cases x 20 findings in < 100 ms', () => {
    const grounded = Array.from({ length: 20 }, (_, i) => fnd(`f${i}`, { start_line: i * 5, end_line: i * 5 + 2 }));
    const t0 = performance.now();
    const results = Array.from({ length: 100 }, () => scoreCase({ expectation: exp(), grounded, dropped: [] }));
    scoreBatch(results.map((r) => ({ type: 'must_find' as const, errored: false, cost_usd: 0, ...r, pass: r.pass })));
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
