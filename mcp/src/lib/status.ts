import type { RunStatus } from '../api/types.js';

const TERMINAL: ReadonlySet<RunStatus> = new Set(['done', 'failed', 'cancelled']);

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL.has(status);
}

/**
 * Run status only moves forward (running -> done|failed|cancelled). Given the
 * last status we showed and a freshly polled one, return the status to use:
 * a terminal status is never overwritten (guards against stale/out-of-order
 * poll responses), and `running` never replaces a terminal one.
 */
export function advanceStatus(prev: RunStatus | undefined, next: RunStatus): RunStatus {
  if (prev === undefined) return next;
  if (isTerminal(prev)) return prev;
  return next;
}
