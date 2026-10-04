/**
 * POST /reviews/by-ref + GET /reviews/latest — run / read reviews addressed by
 * `owner/name` + PR number. Gated on Docker (Postgres), like other it-tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { ReviewByRefResponse, RunDetail } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('reviews by-ref (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let agentA: typeof t.agents.$inferSelect;
  let agentB: typeof t.agents.$inferSelect;
  let agentOff: typeof t.agents.$inferSelect;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    const db = pg.handle.db;
    await seed(db);
    const [ws] = await db.select().from(t.workspaces);
    workspaceId = ws!.id;
    // Isolate from seeded agents so `all:true` only targets the agents below.
    await db.update(t.agents).set({ enabled: false });
    const mk = async (name: string, enabled: boolean) =>
      (
        await db
          .insert(t.agents)
          .values({
            workspaceId,
            name,
            provider: 'openai',
            model: 'gpt-4.1',
            systemPrompt: 'review',
            enabled,
          })
          .returning()
      )[0]!;
    agentA = await mk('by-ref-alpha', true);
    agentB = await mk('by-ref-beta', true);
    agentOff = await mk('by-ref-off', false);
    app = await buildApp({
      config: config(),
      db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: '' }),
        github: new MockGitHubClient({ pulls: [] }),
        llm: { openai: new MockLLMProvider('openai') },
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  async function setupPr() {
    const db = pg.handle.db;
    const name = `by-ref-${seq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 11,
        title: 'T',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'abc',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    return { repo: repo!, pr: pr! };
  }

  const insertRun = async (
    prId: string,
    agentId: string,
    status: string,
    ranAt = new Date(),
  ) =>
    (
      await pg.handle.db
        .insert(t.agentRuns)
        .values({ workspaceId, prId, agentId, provider: 'openai', model: 'gpt-4.1', status, ranAt })
        .returning()
    )[0]!;

  const byRef = (body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/reviews/by-ref', payload: body });

  it('400 when neither agent nor all is given', async () => {
    const { repo } = await setupPr();
    const res = await byRef({ repo: repo.fullName, pr: 11 });
    expect(res.statusCode).toBe(400);
  });

  it('reuses an active run for the same PR + agent (resolved by name)', async () => {
    const { repo, pr } = await setupPr();
    const active = await insertRun(pr.id, agentA.id, 'running');
    const res = await byRef({ repo: repo.fullName, pr: 11, agent: 'By-Ref-Alpha' });
    expect(res.statusCode).toBe(200);
    const body = ReviewByRefResponse.parse(res.json());
    expect(body.pr).toMatchObject({ id: pr.id, number: 11, repo_full_name: repo.fullName });
    expect(body.runs).toEqual([
      { run_id: active.id, agent_id: agentA.id, agent_name: agentA.name, reused: true },
    ]);
    const rows = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr.id));
    expect(rows).toHaveLength(1);
  });

  it('starts a new run (reused:false) when none is active, by agent id', async () => {
    const { repo, pr } = await setupPr();
    const res = await byRef({ repo: repo.fullName, pr: 11, agent: agentA.id });
    expect(res.statusCode).toBe(200);
    const body = ReviewByRefResponse.parse(res.json());
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toMatchObject({ agent_id: agentA.id, reused: false });
    const rows = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr.id));
    expect(rows.map((r) => r.id)).toEqual([body.runs[0]!.run_id]);
  });

  it('422 for a disabled agent, 404 for an unknown agent', async () => {
    const { repo } = await setupPr();
    const off = await byRef({ repo: repo.fullName, pr: 11, agent: agentOff.name });
    expect(off.statusCode).toBe(422);
    expect(off.json().error.message).toContain('disabled');
    const unknown = await byRef({ repo: repo.fullName, pr: 11, agent: 'nope' });
    expect(unknown.statusCode).toBe(404);
  });

  it('404 when the PR is not found (and 404 for an unknown repo)', async () => {
    const { repo } = await setupPr();
    const res = await byRef({ repo: repo.fullName, pr: 999, agent: agentA.id });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toContain('PR #999');
    const noRepo = await byRef({ repo: 'nobody/missing', pr: 1, agent: agentA.id });
    expect(noRepo.statusCode).toBe(404);
  });

  it('all=true reuses active runs and starts the rest', async () => {
    const { repo, pr } = await setupPr();
    const active = await insertRun(pr.id, agentA.id, 'running');
    const res = await byRef({ repo: repo.fullName, pr: 11, all: true });
    expect(res.statusCode).toBe(200);
    const body = ReviewByRefResponse.parse(res.json());
    const names = body.runs.map((r) => r.agent_name).sort();
    expect(names).toEqual([agentA.name, agentB.name]); // disabled agent excluded
    const a = body.runs.find((r) => r.agent_id === agentA.id)!;
    const b = body.runs.find((r) => r.agent_id === agentB.id)!;
    expect(a).toMatchObject({ run_id: active.id, reused: true });
    expect(b.reused).toBe(false);
    expect(b.run_id).not.toBe(active.id);
  });

  it('GET /reviews/latest returns the newest run of each agent', async () => {
    const { repo, pr } = await setupPr();
    const db = pg.handle.db;
    await insertRun(pr.id, agentA.id, 'failed', new Date('2026-01-01T00:00:00Z'));
    const doneA = await insertRun(pr.id, agentA.id, 'done', new Date('2026-01-02T00:00:00Z'));
    const runB = await insertRun(pr.id, agentB.id, 'running', new Date('2026-01-03T00:00:00Z'));
    await db.insert(t.reviews).values({
      workspaceId,
      prId: pr.id,
      runId: doneA.id,
      agentId: agentA.id,
      kind: 'review',
      verdict: 'approve',
      summary: 'ok',
      score: 90,
      model: 'gpt-4.1',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/reviews/latest?repo=${encodeURIComponent(repo.fullName)}&pr=11`,
    });
    expect(res.statusCode).toBe(200);
    const body = (res.json() as unknown[]).map((x) => RunDetail.parse(x));
    expect(body).toHaveLength(2);
    const byAgent = new Map(body.map((x) => [x.run.agent_id, x]));
    expect(byAgent.get(agentA.id)!.run.run_id).toBe(doneA.id);
    expect(byAgent.get(agentA.id)!.review?.score).toBe(90);
    expect(byAgent.get(agentB.id)!.run.run_id).toBe(runB.id);
    expect(byAgent.get(agentB.id)!.review).toBeNull();
  });

  it('GET /reviews/latest 404s for an unknown repo or PR', async () => {
    const { repo } = await setupPr();
    const noRepo = await app.inject({ method: 'GET', url: '/reviews/latest?repo=nobody/x&pr=1' });
    expect(noRepo.statusCode).toBe(404);
    const noPr = await app.inject({
      method: 'GET',
      url: `/reviews/latest?repo=${encodeURIComponent(repo.fullName)}&pr=999`,
    });
    expect(noPr.statusCode).toBe(404);
  });
});
