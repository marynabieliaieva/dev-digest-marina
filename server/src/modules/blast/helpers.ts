import type { BlastRadius } from '@devdigest/shared';
import { MAX_CALLERS_PER_SYMBOL } from '../repo-intel/constants.js';
import type {
  BlastCallerRow,
  BlastResult,
  DegradedReason,
  IndexState,
} from '../repo-intel/types.js';

interface Group {
  symbol: string;
  callers: BlastCallerRow[];
  maxRank: number;
}

const uniq = (xs: string[]): string[] => [...new Set(xs)];

/** Pure mapping of the repo-intel `BlastResult` to the `BlastRadius` contract. */
export function toBlastRadius(
  result: BlastResult,
  opts: { maxCallersPerSymbol?: number } = {},
): BlastRadius {
  const cap = opts.maxCallersPerSymbol ?? MAX_CALLERS_PER_SYMBOL;

  const bySymbol = new Map<string, BlastCallerRow[]>();
  for (const c of result.callers) {
    const declaring = result.changedSymbols
      .filter((s) => s.name === c.viaSymbol)
      .map((s) => s.file);
    if (declaring.includes(c.file)) continue;
    const list = bySymbol.get(c.viaSymbol) ?? [];
    list.push(c);
    bySymbol.set(c.viaSymbol, list);
  }

  const groups: Group[] = [];
  for (const [symbol, rows] of bySymbol) {
    const sorted = [...rows].sort((a, b) => b.rank - a.rank).slice(0, cap);
    if (sorted.length === 0) continue;
    groups.push({ symbol, callers: sorted, maxRank: sorted[0]!.rank });
  }
  groups.sort((a, b) => b.maxRank - a.maxRank || a.symbol.localeCompare(b.symbol));

  const single = groups.length === 1;
  const downstream = groups.map((g) => {
    const files = uniq(g.callers.map((c) => c.file));
    let endpoints: string[];
    let crons: string[];
    if (result.factsByFile) {
      endpoints = uniq(files.flatMap((f) => result.factsByFile![f]?.endpoints ?? []));
      crons = uniq(files.flatMap((f) => result.factsByFile![f]?.crons ?? []));
    } else {
      endpoints = single ? uniq(result.impactedEndpoints) : [];
      crons = [];
    }
    return {
      symbol: g.symbol,
      callers: g.callers.map((c) => ({ name: c.symbol, file: c.file, line: c.line })),
      endpoints_affected: endpoints,
      crons_affected: crons,
    };
  });

  const changed_symbols = result.changedSymbols.map((s) => ({
    name: s.name,
    file: s.file,
    kind: s.kind,
  }));
  const callerTotal = downstream.reduce((n, d) => n + d.callers.length, 0);
  const endpointTotal = uniq(downstream.flatMap((d) => d.endpoints_affected)).length;
  const cronTotal = uniq(downstream.flatMap((d) => d.crons_affected)).length;

  return {
    changed_symbols,
    downstream,
    summary: `${changed_symbols.length} symbols · ${callerTotal} callers · ${endpointTotal} endpoints · ${cronTotal} crons`,
  };
}

/** Number of callers surviving the per-symbol cap (the summary's M). */
export function countCallers(blast: BlastRadius): number {
  return blast.downstream.reduce((n, d) => n + d.callers.length, 0);
}

/** Refines the degraded reason from flag + index state; null when not degraded. */
export function resolveDegradedReason(
  result: BlastResult,
  state: IndexState,
  flagEnabled: boolean,
): DegradedReason | null {
  if (result.degraded !== true) return null;
  if (!flagEnabled) return 'flag_off';
  if (state.degradedReason) return state.degradedReason;
  if (state.status === 'failed') return 'index_failed';
  return result.reason ?? 'no_data';
}
