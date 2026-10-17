import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { LLMProvider, StructuredRequest, StructuredResult, MultiAgentRun, AgentRunEstimate } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test', REPO_INTEL_ENABLED: 'false' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW = { verdict: 'comment', summary: 'ok', score: 90, findings: [] };

/** LLM that never answers until released, so every started run stays `running`. */
class HeldLLM implements LLMProvider {
  readonly id = 'openai' as const;
  private waiters: Array<() => void> = [];
  async listModels() {
    return [];
  }
  async complete(): Promise<never> {
    throw new Error('not used');
  }
  async embed(): Promise<number[][]> {
    return [];
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    await new Promise<void>((r) => this.waiters.push(r));
    const data = (req.schema as { parse(v: unknown): T }).parse(REVIEW);
    return { data, model: req.model, tokensIn: 1, tokensOut: 1, costUsd: 0, raw: '', attempts: 1 };
  }
  release() {
    this.waiters.splice(0).forEach((r) => r());
  }
}

d('multi-agent module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let llm: HeldLLM;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    llm = new HeldLLM();
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), git: new MockGitClient({ diff: DIFF }), llm: { openai: llm } },
    });
  });
  afterAll(async () => {
    llm?.release();
    await app?.close();
    await pg?.stop();
  });

  async function setupPr(ws = workspaceId) {
    const name = `multi-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 500 + seq,
        title: 'Add rate limiting',
        author: 'dev',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'abc1111',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: 'body',
      })
      .returning();
    await pg.handle.db
      .insert(t.prFiles)
      .values({ prId: pr!.id, path: 'src/config.ts', additions: 1, deletions: 0, patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "x",\n   redisUrl: x,' });
    return pr!;
  }

  async function makeAgent(over: { enabled?: boolean } = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: `Agent ${seq++}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
    });
    const agent = res.json() as { id: string; name: string };
    if (over.enabled === false) {
      await pg.handle.db.update(t.agents).set({ enabled: false }).where(eq(t.agents.id, agent.id));
    }
    return agent;
  }

  const start = (prId: string, payload: unknown) =>
    app.inject({ method: 'POST', url: `/pulls/${prId}/multi-agent-run`, payload: payload as object });

  it('AC-1/9/10: POST creates a parent with linked running children in selection order; GET returns it', async () => {
    const pr = await setupPr();
    const [a, b, c] = [await makeAgent(), await makeAgent(), await makeAgent()];

    const noRun = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent` });
    expect(noRun.statusCode).toBe(404);
    expect(noRun.json().error.code).toBe('no_multi_agent_run');

    const res = await start(pr.id, { agentIds: [c.id, a.id, b.id] });
    expect(res.statusCode).toBe(201);
    const run = res.json() as MultiAgentRun;
    expect(run.agent_count).toBe(3);
    expect(run.status).toBe('running');
    expect(run.columns.map((col) => col.agent_id)).toEqual([c.id, a.id, b.id]);
    expect(run.columns.every((col) => col.status === 'running')).toBe(true);

    const parents = await pg.handle.db.select().from(t.multiAgentRuns).where(eq(t.multiAgentRuns.prId, pr.id));
    expect(parents).toHaveLength(1);
    const children = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.multiRunId, run.id));
    expect(children).toHaveLength(3);

    const got = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent` });
    expect(got.statusCode).toBe(200);
    expect((got.json() as MultiAgentRun).id).toBe(run.id);

    // AC-4: the same agents are still running -> 409 naming them, and no second parent.
    const conflict = await start(pr.id, { agentIds: [a.id] });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.details.agents).toEqual([a.name]);
    const after = await pg.handle.db.select().from(t.multiAgentRuns).where(eq(t.multiAgentRuns.prId, pr.id));
    expect(after).toHaveLength(1);

    llm.release();
  });

  it('AC-2/3/12: invalid body 400, unknown 404, disabled 422, other workspace 404; no rows created', async () => {
    const pr = await setupPr();
    const agent = await makeAgent();
    const off = await makeAgent({ enabled: false });

    for (const body of [{}, { agentIds: [] }, { agentIds: ['a', 'a'] }, { agentIds: ['1', '2', '3', '4', '5', '6'] }]) {
      expect((await start(pr.id, body)).statusCode).toBe(400);
    }

    const missingPr = await start('00000000-0000-0000-0000-000000000000', { agentIds: [agent.id] });
    expect(missingPr.statusCode).toBe(404);
    const missingAgent = await start(pr.id, { agentIds: ['00000000-0000-0000-0000-000000000000'] });
    expect(missingAgent.statusCode).toBe(404);
    expect((await start(pr.id, { agentIds: [off.id] })).statusCode).toBe(422);

    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: `other-${seq++}` }).returning();
    const foreign = await setupPr(other!.id);
    expect((await start(foreign.id, { agentIds: [agent.id] })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/pulls/${foreign.id}/multi-agent` })).statusCode).toBe(404);

    for (const id of [pr.id, foreign.id]) {
      expect(await pg.handle.db.select().from(t.multiAgentRuns).where(eq(t.multiAgentRuns.prId, id))).toHaveLength(0);
    }
  });

  it('AC-6: estimates use only the latest 10 done runs', async () => {
    const agent = await makeAgent();
    const pr = await setupPr();
    const base = Date.parse('2026-01-01T00:00:00Z');
    // 12 done runs: the 2 oldest are huge outliers that must be excluded; plus a newer failed run.
    const rows = Array.from({ length: 12 }, (_, i) => ({
      workspaceId,
      agentId: agent.id,
      prId: pr.id,
      status: 'done',
      ranAt: new Date(base + i * 1000),
      durationMs: i < 2 ? 1_000_000 : 100 + i,
      costUsd: i < 2 ? 99 : 0.01,
    }));
    rows.push({ workspaceId, agentId: agent.id, prId: pr.id, status: 'failed', ranAt: new Date(base + 99_000), durationMs: 5, costUsd: 5 });
    await pg.handle.db.insert(t.agentRuns).values(rows);

    const res = await app.inject({ method: 'GET', url: '/agents/run-estimates' });
    expect(res.statusCode).toBe(200);
    const est = (res.json() as AgentRunEstimate[]).find((e) => e.agent_id === agent.id)!;
    expect(est.sample_size).toBe(10);
    // durations of runs i=2..11 are 102..111 -> median 106.5; outliers and the failed run are ignored.
    expect(est.est_duration_ms).toBe(106.5);
    expect(est.est_cost_usd).toBe(0.01);
  });
});
