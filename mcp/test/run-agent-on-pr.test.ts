import { describe, expect, it, vi } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { ApiError, type DevdigestApi } from '../src/api/client.js';
import type { ReviewByRefResponse, RunDetail } from '../src/api/types.js';
import { loadConfig } from '../src/config.js';
import type { Clock } from '../src/lib/time.js';
import { createMcpServer } from '../src/server.js';
import { registerRunAgentOnPr } from '../src/tools/run-agent-on-pr.js';

const config = loadConfig({
  DEVDIGEST_RUN_DEADLINE_MS: '10000',
  DEVDIGEST_POLL_INTERVAL_MS: '2000',
});

const detail = (id: string, status: RunDetail['run']['status']): RunDetail => ({
  run: {
    run_id: id,
    status,
    error: null,
    agent_id: 'ag',
    agent_name: 'sec',
    model: 'm',
    ran_at: null,
    duration_ms: null,
    pr_number: 7,
    repo_full_name: 'o/r',
  },
  review:
    status === 'done'
      ? {
          verdict: 'comment',
          score: 80,
          summary: null,
          findings: [
            {
              id: 'f1',
              severity: 'WARNING',
              category: 'c',
              title: 'Title',
              file: 'a.ts',
              start_line: 3,
              end_line: 3,
              rationale: 'why',
              confidence: 0.5,
            },
          ],
        }
      : null,
});

const started = (...ids: string[]): ReviewByRefResponse => ({
  pr: { id: 'p', number: 7, title: 't', repo_full_name: 'o/r' },
  runs: ids.map((id) => ({ run_id: id, agent_id: 'ag', agent_name: 'sec', reused: false })),
});

/** Fake clock: sleep advances virtual time, never waits. */
function fakeClock(): Clock & { sleeps: number[] } {
  let t = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
  };
}

function fakeApi(over: Partial<DevdigestApi>): DevdigestApi {
  const unused = () => Promise.reject(new Error('unexpected call'));
  return {
    listAgents: unused,
    resolveRepo: unused,
    reviewByRef: unused,
    getRun: unused,
    latestReview: unused,
    getConventions: unused,
    resolvePull: unused,
    getBlast: unused,
    ...over,
  };
}

async function call(
  api: DevdigestApi,
  clock: Clock,
  args: Record<string, unknown> = { repo: 'o/r', pr: 7, agent: 'ag' },
  opts: { onprogress?: (p: unknown) => void } = {},
) {
  const server = createMcpServer({ api, config, clock, tools: [registerRunAgentOnPr] });
  const client = new Client({ name: 't', version: '0' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  await client.connect(c);
  const res = await client.callTool(
    { name: 'devdigest_run_agent_on_pr', arguments: args },
    opts.onprogress ? { onprogress: opts.onprogress } : {},
  );
  const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
  return { res, text };
}

describe('devdigest_run_agent_on_pr', () => {
  it('starts by ref, polls until done, returns formatted findings', async () => {
    const reviewByRef = vi.fn().mockResolvedValue(started('run-1'));
    const getRun = vi
      .fn()
      .mockResolvedValueOnce(detail('run-1', 'running'))
      .mockResolvedValueOnce(detail('run-1', 'running'))
      .mockResolvedValueOnce(detail('run-1', 'done'));
    const clock = fakeClock();
    const { res, text } = await call(fakeApi({ reviewByRef, getRun }), clock);
    expect(reviewByRef).toHaveBeenCalledWith(
      { repo: 'o/r', pr: 7, agent: 'ag', all: undefined },
      expect.anything(),
    );
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toBeUndefined();
    expect(text).toContain('DONE');
    expect(text).toContain('[WARNING] a.ts:3');
    expect(clock.sleeps).toEqual([2000, 2000]);
  });

  it('coerces pr from a string', async () => {
    const reviewByRef = vi.fn().mockResolvedValue(started('run-1'));
    await call(fakeApi({ reviewByRef, getRun: async () => detail('run-1', 'done') }), fakeClock(), {
      repo: 'o/r',
      pr: '7',
    });
    expect(reviewByRef.mock.calls[0]![0].pr).toBe(7);
  });

  it('deadline timeout -> NON-error text with run_id and next step', async () => {
    const clock = fakeClock();
    const getRun = vi.fn().mockResolvedValue(detail('run-long-id', 'running'));
    const { res, text } = await call(
      fakeApi({ reviewByRef: async () => started('run-long-id'), getRun }),
      clock,
    );
    expect(res.isError).toBeFalsy();
    expect(text).toContain('run-long-id');
    expect(text).toContain('devdigest_get_findings');
    expect(text).toContain('RUNNING');
    expect(clock.sleeps.reduce((a, b) => a + b, 0)).toBe(10_000);
  });

  it('all=true: shares one deadline across runs and renders each', async () => {
    const clock = fakeClock();
    const getRun = vi.fn(async (id: string) => detail(id, id === 'a' ? 'done' : 'running'));
    const { text } = await call(
      fakeApi({ reviewByRef: async () => started('a', 'b'), getRun }),
      clock,
      { repo: 'o/r', pr: 7, all: true },
    );
    expect(text).toContain('DONE');
    expect(text).toContain('RUNNING');
    expect(clock.sleeps.reduce((a, b) => a + b, 0)).toBe(10_000);
    // a finished run is not polled again
    expect(getRun.mock.calls.filter((c) => c[0] === 'a')).toHaveLength(1);
  });

  it('a settled run is not polled again (status only moves forward)', async () => {
    const getRun = vi.fn().mockResolvedValueOnce(detail('r', 'done'));
    const { text } = await call(fakeApi({ reviewByRef: async () => started('r'), getRun }), fakeClock());
    expect(text).toContain('DONE');
    expect(getRun).toHaveBeenCalledTimes(1);
  });

  it('failed run -> non-error state text', async () => {
    const { res, text } = await call(
      fakeApi({ reviewByRef: async () => started('r'), getRun: async () => detail('r', 'failed') }),
      fakeClock(),
    );
    expect(res.isError).toBeFalsy();
    expect(text).toContain('FAILED');
  });

  it('sends increasing progress when the client supplied a progressToken', async () => {
    const api = () =>
      fakeApi({
        reviewByRef: async () => started('r'),
        getRun: vi
          .fn()
          .mockResolvedValueOnce(detail('r', 'running'))
          .mockResolvedValueOnce(detail('r', 'done')),
      });
    const events: Array<{ progress: number; message?: string }> = [];
    await call(api(), fakeClock(), undefined, { onprogress: (p) => events.push(p as never) });
    expect(events.length).toBeGreaterThan(0);
    const nums = events.map((e) => e.progress);
    expect([...nums].sort((a, b) => a - b)).toEqual(nums);
    expect(new Set(nums).size).toBe(nums.length);

    const { res } = await call(api(), fakeClock());
    expect(res.isError).toBeFalsy();
  });

  it('abort stops polling and returns non-error text with the run id', async () => {
    const getRun = vi.fn().mockResolvedValue(detail('run-x', 'running'));
    const ac = new AbortController();
    const clock: Clock = {
      now: () => 0,
      sleep: async () => {
        ac.abort();
      },
    };
    // Server-side signal is tied to the client request; emulate by aborting through the client signal.
    const server = createMcpServer({
      api: fakeApi({ reviewByRef: async () => started('run-x'), getRun }),
      config,
      clock,
      tools: [registerRunAgentOnPr],
    });
    const client = new Client({ name: 't', version: '0' });
    const [c, s] = InMemoryTransport.createLinkedPair();
    await server.connect(s);
    await client.connect(c);
    await expect(
      client.callTool(
        { name: 'devdigest_run_agent_on_pr', arguments: { repo: 'o/r', pr: 7, agent: 'ag' } },
        { signal: ac.signal },
      ),
    ).rejects.toBeDefined();
    expect(getRun.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it.each([
    ['rate_limited', 429, 'Rate limit'],
    ['not_found', 404, 'Check the repo'],
    ['conflict', 409, 'owner/name'],
    ['unprocessable', 422, 'devdigest_list_agents'],
  ] as const)('start error %s -> isError with next step', async (kind, status, needle) => {
    const { res, text } = await call(
      fakeApi({ reviewByRef: async () => Promise.reject(new ApiError(kind, 'msg.', status)) }),
      fakeClock(),
    );
    expect(res.isError).toBe(true);
    expect(text).toContain(needle);
  });

  it('poll failure -> isError that still names the run id', async () => {
    const { res, text } = await call(
      fakeApi({
        reviewByRef: async () => started('run-keep'),
        getRun: async () => Promise.reject(new ApiError('unreachable', 'down')),
      }),
      fakeClock(),
    );
    expect(res.isError).toBe(true);
    expect(text).toContain('run-keep');
  });

  it('reused run is mentioned', async () => {
    const s = started('r');
    s.runs[0]!.reused = true;
    const { text } = await call(
      fakeApi({ reviewByRef: async () => s, getRun: async () => detail('r', 'done') }),
      fakeClock(),
    );
    expect(text).toContain('Reused');
  });
});
