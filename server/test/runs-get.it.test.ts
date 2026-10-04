import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { RunDetail } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('GET /runs/:id (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), git: new MockGitClient({ diff: '' }) },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  async function setup(ws: string, status: string | null, opts: { error?: string } = {}) {
    const db = pg.handle.db;
    const name = `runs-get-${seq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 7,
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
    const [run] = await db
      .insert(t.agentRuns)
      .values({
        workspaceId: ws,
        prId: pr!.id,
        model: 'gpt-4.1',
        provider: 'openai',
        status,
        error: opts.error ?? null,
        durationMs: 1234,
      })
      .returning();
    return { repo: repo!, pr: pr!, run: run! };
  }

  it('done run returns run metadata + review with findings', async () => {
    const { run, repo } = await setup(workspaceId, 'done');
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: run.prId!,
        runId: run.id,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'bad',
        score: 65,
        model: 'gpt-4.1',
      })
      .returning();
    await pg.handle.db.insert(t.findings).values({
      reviewId: review!.id,
      file: 'a.ts',
      startLine: 1,
      endLine: 2,
      severity: 'CRITICAL',
      category: 'security',
      title: 'Leak',
      rationale: 'because',
      confidence: 0.9,
    });

    const res = await app.inject({ method: 'GET', url: `/runs/${run.id}` });
    expect(res.statusCode).toBe(200);
    const body = RunDetail.parse(res.json());
    expect(body.run).toMatchObject({
      run_id: run.id,
      status: 'done',
      pr_number: 7,
      repo_full_name: repo.fullName,
      duration_ms: 1234,
    });
    expect(body.review?.verdict).toBe('request_changes');
    expect(body.review?.score).toBe(65);
    expect(body.review?.findings).toHaveLength(1);
    expect(body.review?.findings[0]).toMatchObject({ title: 'Leak', severity: 'CRITICAL' });
  });

  it('running run has review: null', async () => {
    const { run } = await setup(workspaceId, 'running');
    const res = await app.inject({ method: 'GET', url: `/runs/${run.id}` });
    expect(res.statusCode).toBe(200);
    const body = RunDetail.parse(res.json());
    expect(body.run.status).toBe('running');
    expect(body.review).toBeNull();
  });

  it('failed run exposes the error and no review', async () => {
    const { run } = await setup(workspaceId, 'failed', { error: 'LLM timeout' });
    const body = RunDetail.parse(
      (await app.inject({ method: 'GET', url: `/runs/${run.id}` })).json(),
    );
    expect(body.run.status).toBe('failed');
    expect(body.run.error).toBe('LLM timeout');
    expect(body.review).toBeNull();
  });

  it('404 for a run in another workspace and for an unknown id', async () => {
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other' })
      .returning();
    const { run } = await setup(other!.id, 'running');
    const foreign = await app.inject({ method: 'GET', url: `/runs/${run.id}` });
    expect(foreign.statusCode).toBe(404);

    const unknown = await app.inject({
      method: 'GET',
      url: '/runs/00000000-0000-4000-8000-000000000000',
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('422 for a non-uuid id', async () => {
    const res = await app.inject({ method: 'GET', url: '/runs/not-a-uuid' });
    expect(res.statusCode).toBe(422);
  });
});
