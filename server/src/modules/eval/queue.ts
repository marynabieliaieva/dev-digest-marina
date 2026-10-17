/**
 * Process-wide FIFO that executes eval batches one at a time (set, case and
 * run-all alike). In-memory on purpose: a restart orphans queued batches, which
 * the stale rule (`isStaleBatch`) then cleans up. `liveIds()` lets that rule
 * tell "still waiting its turn" from "orphaned".
 */
export type EvalTask = () => Promise<void>;

export class EvalQueue {
  private waiting: { batchId: string; task: EvalTask }[] = [];
  private current: string | null = null;
  private draining = false;
  private idleWaiters: (() => void)[] = [];

  /** Queue a batch; execution starts as soon as nothing else is running. */
  enqueue(batchId: string, task: EvalTask): void {
    this.waiting.push({ batchId, task });
    void this.drain();
  }

  /** Ids of the running batch plus every batch still waiting. */
  liveIds(): Set<string> {
    const ids = new Set(this.waiting.map((w) => w.batchId));
    if (this.current) ids.add(this.current);
    return ids;
  }

  /** Resolves once the queue is empty and nothing is running (tests). */
  idle(): Promise<void> {
    if (!this.draining && this.waiting.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let next = this.waiting.shift(); next; next = this.waiting.shift()) {
        this.current = next.batchId;
        try {
          await next.task();
        } catch {
          // The task owns its own failure handling; the queue must never stall.
        }
        this.current = null;
      }
    } finally {
      this.draining = false;
      const waiters = this.idleWaiters.splice(0);
      for (const w of waiters) w();
    }
  }
}

/** The single queue shared by every eval module instance in this process. */
export const evalQueue = new EvalQueue();
