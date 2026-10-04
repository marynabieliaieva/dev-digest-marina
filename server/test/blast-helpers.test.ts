import { describe, it, expect } from 'vitest';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';
import type { BlastCallerRow, BlastResult, IndexState } from '../src/modules/repo-intel/types.js';
import { countCallers, resolveDegradedReason, toBlastRadius } from '../src/modules/blast/helpers.js';

const caller = (
  viaSymbol: string,
  file: string,
  rank: number,
  over: Partial<BlastCallerRow> = {},
): BlastCallerRow => ({ file, symbol: `use_${file}`, viaSymbol, line: 10, rank, ...over });

const result = (over: Partial<BlastResult> = {}): BlastResult => ({
  changedSymbols: [],
  callers: [],
  impactedEndpoints: [],
  ...over,
});

describe('toBlastRadius', () => {
  it('groups callers by viaSymbol and excludes callers in the declaring file', () => {
    const blast = toBlastRadius(
      result({
        changedSymbols: [
          { name: 'foo', file: 'src/foo.ts', kind: 'function' },
          { name: 'bar', file: 'src/bar.ts', kind: 'function' },
        ],
        callers: [
          caller('foo', 'src/a.ts', 5),
          caller('foo', 'src/foo.ts', 9), // declaring file: dropped
          caller('bar', 'src/b.ts', 3),
        ],
      }),
    );
    expect(blast.downstream.map((d) => d.symbol).sort()).toEqual(['bar', 'foo']);
    const foo = blast.downstream.find((d) => d.symbol === 'foo')!;
    expect(foo.callers.map((c) => c.file)).toEqual(['src/a.ts']);
    expect(foo.callers[0]).toEqual({ name: 'use_src/a.ts', file: 'src/a.ts', line: 10 });
  });

  it('keeps only the highest-rank MAX_CALLERS_PER_SYMBOL callers of one symbol', () => {
    const total = MAX_CALLERS_PER_SYMBOL + 5;
    // file index == rank; input order scrambled so the helper must sort by rank
    const callers = Array.from({ length: total }, (_, i) =>
      caller('foo', `src/f${i + 1}.ts`, i + 1),
    ).sort((a, b) => (a.rank % 7) - (b.rank % 7) || a.rank - b.rank);
    const blast = toBlastRadius(
      result({ changedSymbols: [{ name: 'foo', file: 'src/foo.ts', kind: 'function' }], callers }),
    );
    const kept = blast.downstream[0]!.callers;
    expect(kept).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    const expected = Array.from({ length: MAX_CALLERS_PER_SYMBOL }, (_, i) => `src/f${total - i}.ts`);
    expect(kept.map((c) => c.file)).toEqual(expected);
  });

  it('puts crons in crons_affected and endpoints in endpoints_affected, separately', () => {
    const blast = toBlastRadius(
      result({
        changedSymbols: [{ name: 'foo', file: 'src/foo.ts', kind: 'function' }],
        callers: [caller('foo', 'src/a.ts', 2), caller('foo', 'src/b.ts', 1)],
        factsByFile: {
          'src/a.ts': { endpoints: ['GET /x'], crons: [] },
          'src/b.ts': { endpoints: ['GET /x'], crons: ['nightly'] },
        },
      }),
    );
    expect(blast.downstream[0]!.endpoints_affected).toEqual(['GET /x']);
    expect(blast.downstream[0]!.crons_affected).toEqual(['nightly']);
  });

  it('without factsByFile: one group gets impactedEndpoints, 2+ groups get []', () => {
    const syms = [
      { name: 'foo', file: 'src/foo.ts', kind: 'function' },
      { name: 'bar', file: 'src/bar.ts', kind: 'function' },
    ];
    const single = toBlastRadius(
      result({
        changedSymbols: syms,
        callers: [caller('foo', 'src/a.ts', 1)],
        impactedEndpoints: ['POST /y'],
      }),
    );
    expect(single.downstream).toHaveLength(1);
    expect(single.downstream[0]!.endpoints_affected).toEqual(['POST /y']);
    expect(single.downstream[0]!.crons_affected).toEqual([]);

    const multi = toBlastRadius(
      result({
        changedSymbols: syms,
        callers: [caller('foo', 'src/a.ts', 1), caller('bar', 'src/b.ts', 1)],
        impactedEndpoints: ['POST /y'],
      }),
    );
    expect(multi.downstream).toHaveLength(2);
    for (const d of multi.downstream) {
      expect(d.endpoints_affected).toEqual([]);
      expect(d.crons_affected).toEqual([]);
    }
  });

  it('orders downstream by max caller rank desc, ties by symbol name asc', () => {
    const blast = toBlastRadius(
      result({
        changedSymbols: ['low', 'high', 'tieB', 'tieA'].map((name) => ({
          name,
          file: `src/${name}.ts`,
          kind: 'function',
        })),
        callers: [
          caller('low', 'src/c1.ts', 1),
          caller('high', 'src/c2.ts', 9),
          caller('tieB', 'src/c3.ts', 5),
          caller('tieA', 'src/c4.ts', 5),
        ],
      }),
    );
    expect(blast.downstream.map((d) => d.symbol)).toEqual(['high', 'tieA', 'tieB', 'low']);
  });

  it('lists a caller-less symbol in changed_symbols but not in downstream', () => {
    const blast = toBlastRadius(
      result({
        changedSymbols: [
          { name: 'foo', file: 'src/foo.ts', kind: 'function' },
          { name: 'lonely', file: 'src/l.ts', kind: 'class' },
        ],
        callers: [caller('foo', 'src/a.ts', 1)],
      }),
    );
    expect(blast.changed_symbols).toEqual([
      { name: 'foo', file: 'src/foo.ts', kind: 'function' },
      { name: 'lonely', file: 'src/l.ts', kind: 'class' },
    ]);
    expect(blast.downstream.map((d) => d.symbol)).toEqual(['foo']);
  });

  it('builds the exact summary string and countCallers matches its caller count', () => {
    const blast = toBlastRadius(
      result({
        changedSymbols: [
          { name: 'foo', file: 'src/foo.ts', kind: 'function' },
          { name: 'bar', file: 'src/bar.ts', kind: 'function' },
          { name: 'idle', file: 'src/i.ts', kind: 'function' },
        ],
        callers: [
          caller('foo', 'src/a.ts', 3),
          caller('foo', 'src/b.ts', 2),
          caller('bar', 'src/b.ts', 1),
        ],
        factsByFile: {
          'src/a.ts': { endpoints: ['GET /x'], crons: [] },
          'src/b.ts': { endpoints: ['GET /x', 'GET /z'], crons: ['nightly'] },
        },
      }),
    );
    // endpoints unique across groups: GET /x, GET /z = 2; crons: nightly = 1
    expect(blast.summary).toBe('3 symbols · 3 callers · 2 endpoints · 1 crons');
    expect(countCallers(blast)).toBe(3);
  });
});

describe('resolveDegradedReason', () => {
  const state = (over: Partial<IndexState> = {}): IndexState => ({
    repoId: 'r',
    status: 'full',
    filesIndexed: 0,
    filesSkipped: 0,
    durationMs: 0,
    lastIndexedSha: 'sha',
    indexerVersion: 1,
    updatedAt: new Date(0),
    ...over,
  });
  const degraded = (over: Partial<BlastResult> = {}) => result({ degraded: true, ...over });

  it('maps degraded + flag + index state to the right reason', () => {
    expect(resolveDegradedReason(result({ degraded: false }), state(), false)).toBeNull();
    expect(resolveDegradedReason(result(), state(), false)).toBeNull();
    expect(resolveDegradedReason(degraded(), state(), false)).toBe('flag_off');
    expect(
      resolveDegradedReason(degraded(), state({ degradedReason: 'repo_too_large' }), true),
    ).toBe('repo_too_large');
    expect(resolveDegradedReason(degraded(), state({ status: 'failed' }), true)).toBe('index_failed');
    expect(resolveDegradedReason(degraded({ reason: 'index_partial' }), state(), true)).toBe(
      'index_partial',
    );
    expect(resolveDegradedReason(degraded(), state(), true)).toBe('no_data');
  });
});
