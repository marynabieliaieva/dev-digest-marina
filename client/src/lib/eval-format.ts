/* eval-format.ts — pure number formatting for the eval UI (percent, signed
   point deltas, dollars). `null` always means "not computed" and renders "—". */

const DASH = "—";
const MINUS = "−";

/** Fraction 0..1 → "87%" (0 decimals); null → "—". */
export function pct(x: number | null | undefined): string {
  if (x == null || Number.isNaN(x)) return DASH;
  return `${Math.round(x * 100)}%`;
}

/** Signed delta in percentage points between two fractions: "+3 pts" / "−2 pts". */
export function deltaPts(cur: number | null | undefined, prev: number | null | undefined): string {
  if (cur == null || prev == null) return DASH;
  const n = Math.round((cur - prev) * 100);
  if (n === 0) return "0 pts";
  return `${n > 0 ? "+" : MINUS}${Math.abs(n)} pts`;
}

/** Dollars with 4 decimals; null → "—". */
export function usd(x: number | null | undefined): string {
  if (x == null || Number.isNaN(x)) return DASH;
  return `$${x.toFixed(4)}`;
}

/** Signed dollar delta: "+$0.0012" / "−$0.0012". */
export function deltaUsd(cur: number | null | undefined, prev: number | null | undefined): string {
  if (cur == null || prev == null) return DASH;
  const diff = cur - prev;
  const abs = Math.abs(diff).toFixed(4);
  if (Number(abs) === 0) return "$0.0000";
  return `${diff > 0 ? "+" : MINUS}$${abs}`;
}
