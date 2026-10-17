import { describe, expect, it } from 'vitest';
import type {
  CompletionResult,
  EvalConfigSnapshot,
  EvalExpectation,
  LLMProvider,
  Provider,
  Review,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import {
  EvalExecutor,
  type BatchAggregates,
  type CaseRecord,
  type EvalExecutorRepo,
  type EvalJob,
  type EvalJobCase,
} from './executor.js';
import { EvalQueue } from './queue.js';

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,4 @@',
  ' const a = 1;',
  '+const b = 2;',
  '+const c = 3;',
  ' export {};',
  '',
].join('\n');

const EXPECTATION: EvalExpectation = {
  type: 'must_find',
  file: 'src/a.ts',
  start_line: 2,
  end_line: 3,
  kind: 'finding',
  severity: 'WARNING',
  category: 'bug',
  title: 'b is wrong',
  source_finding_id: 'f-src',
};

function finding(id: string, start: number, end: number) {
  return {
    id,
    severity: 'WARNING' as const,
    category: 'bug' as const,
    title: `finding ${id}`,
    file: 'src/a.ts',
    start_line: start,
    end_line: end,
    rationale: 'because',
    confidence: 0.9,
  };
}

function review(findings: ReturnType<typeof finding>[]): Review {
  return { verdict: 'comment', summary: 'ok', score: 80, findings } as Review;
}

type Responder = (call: number) => Review | Error;

class ScriptedLLM implements LLMProvider {
  readonly id = 'openrouter' as const;
  requests: StructuredRequest<unknown>[] = [];
  otherCalls = 0;
  constructor(private respond: Responder) {}
  async listModels() {
    this.otherCalls++;
    return [];
  }
  async complete(): Promise<CompletionResult> {
    this.otherCalls++;
    throw new Error('complete must not be called');
  }
  async embed(): Promise<number[][]> {
    this.otherCalls++;
    throw new Error('embed must not be called');
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.requests.push(req as StructuredRequest<unknown>);
    const out = this.respond(this.requests.length);
    if (out instanceof Error) throw out;
    return {
      data: out as unknown as T,
      model: req.model,
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.001,
      raw: JSON.stringify(out),
      attempts: 1,
    };
  }
}

class FakeRepo implements EvalExecutorRepo {
  calls: string[] = [];
  records: CaseRecord[] = [];
  aggregates: BatchAggregates | null = null;
  status: 'running' | 'done' | 'failed' = 'running';
  error: string | null = null;
  casesDone = 0;
  async recordCase(_batchId: string, record: CaseRecord) {
    this.calls.push('recordCase');
    this.records.push(record);
    this.casesDone++;
  }
  async writeAggregates(_batchId: string, aggregates: BatchAggregates) {
    this.calls.push('writeAggregates');
    this.aggregates = aggregates;
  }
  async markDone() {
    this.calls.push('markDone');
    this.status = 'done';
  }
  async markFailed(_batchId: string, error: string) {
    this.calls.push('markFailed');
    this.status = 'failed';
    this.error = error;
  }
}

const CONFIG: EvalConfigSnapshot = {
  provider: 'openrouter',
  model: 'snap-model',
  system_prompt: 'SNAPSHOT-PROMPT',
  strategy: 'single-pass',
  skills: [{ name: 'Lint', body: 'SKILL-BODY-MARKER' }],
};

function makeCase(id: string, expectation: EvalExpectation = EXPECTATION): EvalJobCase {
  return {
    id,
    name: `case ${id}`,
    inputDiff: DIFF,
    pr: { number: 7, title: 'Add b', body: 'PR-BODY-MARKER' },
    expectation,
  };
}

function makeJob(cases: EvalJobCase[], config: EvalConfigSnapshot = CONFIG): EvalJob {
  return {
    batchId: 'b1',
    agentName: 'Agent',
    agentVersion: 3,
    startedAt: new Date('2026-01-01T00:00:00Z'),
    config,
    cases,
  };
}

function setup(respond: Responder, resolve?: (p: Provider) => Promise<LLMProvider>) {
  const repo = new FakeRepo();
  const llm = new ScriptedLLM(respond);
  const logs: { level: string; msg?: string }[] = [];
  const executor = new EvalExecutor({
    repo,
    resolveLlm: resolve ?? (async () => llm),
    logger: {
      info: (_o, msg) => logs.push({ level: 'info', ...(msg ? { msg } : {}) }),
      error: (_o, msg) => logs.push({ level: 'error', ...(msg ? { msg } : {}) }),
    },
    now: () => new Date(),
  });
  return { repo, llm, executor, logs };
}

const userText = (req: StructuredRequest<unknown>) =>
  req.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
const systemText = (req: StructuredRequest<unknown>) =>
  req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');

describe('EvalExecutor', () => {
  it('reviews with only the frozen snapshot and case data (AC-31)', async () => {
    const { executor, llm, repo } = setup(() => review([finding('x1', 2, 3)]));
    await executor.run(makeJob([makeCase('c1')]));

    expect(llm.requests).toHaveLength(1);
    const req = llm.requests[0]!;
    expect(req.model).toBe('snap-model');
    expect(systemText(req)).toContain('SNAPSHOT-PROMPT');
    const user = userText(req);
    expect(user).toContain('SKILL-BODY-MARKER');
    expect(user).toContain('PR-BODY-MARKER');
    expect(user).toContain('pull request #7');
    for (const heading of [
      '## Derived intent',
      '## Callers of changed symbols',
      '## Repo skeleton',
      '## Project context',
      '## Relevant memory',
    ]) {
      expect(user).not.toContain(heading);
    }
    expect(repo.status).toBe('done');
  });

  it('is unaffected by agent edits made between cases (AC-32)', async () => {
    const live = { systemPrompt: 'SNAPSHOT-PROMPT' };
    const { executor, llm } = setup((call) => {
      live.systemPrompt = `EDITED-${call}`; // the "live" agent changes mid-batch
      return review([finding('x', 2, 3)]);
    });
    await executor.run(makeJob([makeCase('c1'), makeCase('c2')]));
    for (const req of llm.requests) {
      expect(systemText(req)).toContain('SNAPSHOT-PROMPT');
      expect(systemText(req)).not.toContain('EDITED');
    }
  });

  it('keeps going when one case throws and records it with pass = null (AC-34)', async () => {
    const { executor, repo } = setup((call) =>
      call === 2 ? new Error('provider exploded') : review([finding('x', 2, 3)]),
    );
    await executor.run(makeJob([makeCase('c1'), makeCase('c2'), makeCase('c3')]));

    expect(repo.status).toBe('done');
    expect(repo.records).toHaveLength(3);
    expect(repo.records.filter((r) => r.pass === true)).toHaveLength(2);
    const errored = repo.records[1]!;
    expect(errored.pass).toBeNull();
    expect(errored.error).toBe('provider exploded');
    expect(repo.aggregates?.tracesTotal).toBe(3);
    expect(repo.aggregates?.tracesPassed).toBe(2);
    expect(repo.casesDone).toBe(3);
  });

  it('fails the batch without running any case when the provider cannot be resolved (AC-35)', async () => {
    const { executor, repo, llm } = setup(
      () => review([]),
      async () => {
        throw new Error('OPENROUTER_API_KEY is not configured');
      },
    );
    await executor.run(makeJob([makeCase('c1'), makeCase('c2')]));

    expect(repo.status).toBe('failed');
    expect(repo.error).toBe('OPENROUTER_API_KEY is not configured');
    expect(repo.records).toHaveLength(0);
    expect(llm.requests).toHaveLength(0);
  });

  it('counts a finding outside any hunk as a dropped citation (AC-47)', async () => {
    const { executor, repo } = setup(() =>
      review([finding('g1', 2, 2), finding('g2', 3, 3), finding('bad', 90, 95)]),
    );
    await executor.run(makeJob([makeCase('c1')]));

    const rec = repo.records[0]!;
    expect(rec.citationAccuracy).toBeCloseTo(2 / 3, 3);
    const out = rec.actualOutput as { findings: unknown[]; dropped: unknown[]; matched_finding_ids: string[] };
    expect(out.findings).toHaveLength(2);
    expect(out.dropped).toHaveLength(1);
    expect(out.matched_finding_ids.sort()).toEqual(['g1', 'g2']);
  });

  it('calls the model once per case and never during scoring (AC-46)', async () => {
    const { executor, llm, repo } = setup(() => review([finding('x', 2, 3)]));
    await executor.run(makeJob([makeCase('c1'), makeCase('c2'), makeCase('c3')]));
    expect(llm.requests).toHaveLength(3);
    expect(llm.otherCalls).toBe(0);
    expect(repo.records).toHaveLength(3);
  });

  it('writes aggregates before the terminal status', async () => {
    const { executor, repo } = setup(() => review([finding('x', 2, 3)]));
    await executor.run(makeJob([makeCase('c1'), makeCase('c2')]));
    expect(repo.calls).toEqual(['recordCase', 'recordCase', 'writeAggregates', 'markDone']);
    expect(repo.aggregates?.recall).toBe(1);
  });

  it('logs batch start, batch end and each case error', async () => {
    const { executor, logs } = setup((call) => (call === 1 ? new Error('boom') : review([])));
    await executor.run(makeJob([makeCase('c1'), makeCase('c2')]));
    expect(logs.filter((l) => l.level === 'error')).toHaveLength(1);
    expect(logs.some((l) => l.msg?.includes('batch started'))).toBe(true);
    expect(logs.some((l) => l.msg?.includes('batch done'))).toBe(true);
  });
});

describe('EvalQueue', () => {
  it('runs enqueued batches strictly one after the other, in order, and tracks live ids (AC-66)', async () => {
    const queue = new EvalQueue();
    const events: string[] = [];
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => (releaseA = r));

    queue.enqueue('a', async () => {
      events.push('a:start');
      await gateA;
      events.push('a:end');
    });
    queue.enqueue('b', async () => {
      events.push('b:start');
      events.push('b:end');
    });
    queue.enqueue('c', async () => {
      events.push('c:start');
    });

    await Promise.resolve();
    expect(events).toEqual(['a:start']);
    expect([...queue.liveIds()].sort()).toEqual(['a', 'b', 'c']);

    releaseA();
    await queue.idle();
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start']);
    expect(queue.liveIds().size).toBe(0);
  });

  it('keeps draining after a task throws', async () => {
    const queue = new EvalQueue();
    const ran: string[] = [];
    queue.enqueue('x', async () => {
      throw new Error('nope');
    });
    queue.enqueue('y', async () => {
      ran.push('y');
    });
    await queue.idle();
    expect(ran).toEqual(['y']);
  });

  it('runs agents in enqueue (name) order', async () => {
    const queue = new EvalQueue();
    const order: string[] = [];
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      queue.enqueue(name, async () => {
        order.push(name);
      });
    }
    await queue.idle();
    expect(order).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
});
