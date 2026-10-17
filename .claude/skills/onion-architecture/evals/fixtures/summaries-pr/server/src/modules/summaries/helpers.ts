import { MAX_DIFF_CHARS } from './constants.js';

export function summaryCacheKey(prId: string, maxWords: number): string {
  return `summary:${prId}:${maxWords}`;
}

export function truncateDiff(diff: string): string {
  return diff.length > MAX_DIFF_CHARS ? diff.slice(0, MAX_DIFF_CHARS) : diff;
}
