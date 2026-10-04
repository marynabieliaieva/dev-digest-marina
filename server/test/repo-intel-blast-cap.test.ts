import { describe, it, expect } from 'vitest';
import { capCallersPerSymbol } from '../src/modules/repo-intel/service.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';
import type { BlastCallerRow } from '../src/modules/repo-intel/types.js';

describe('capCallersPerSymbol', () => {
  it('caps per viaSymbol (not globally) and preserves input order', () => {
    const n = MAX_CALLERS_PER_SYMBOL + 5;
    const rows: BlastCallerRow[] = [];
    // interleave two symbols, rank-desc overall
    for (let i = 0; i < n; i++) {
      for (const via of ['alpha', 'beta']) {
        rows.push({ file: `src/${via}${i}.ts`, symbol: 's', viaSymbol: via, line: 1, rank: n - i });
      }
    }
    const out = capCallersPerSymbol(rows, MAX_CALLERS_PER_SYMBOL);
    expect(out.filter((r) => r.viaSymbol === 'alpha')).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(out.filter((r) => r.viaSymbol === 'beta')).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(out).toHaveLength(MAX_CALLERS_PER_SYMBOL * 2);
    // order preserved: the output is a subsequence of the input, first rows kept
    expect(out).toEqual(rows.slice(0, MAX_CALLERS_PER_SYMBOL * 2));
  });
});
