/**
 * PullsService — findByNumber / syncFromGitHub / refreshFiles / findOrSync, and
 * the unchanged GET /repos/:id/pulls + GET /pulls/:id routes built on it.
 * Gated on Docker (Postgres), like the other integration tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import { PullsService } from '../src/modules/pulls/service.js';
import * as t from '../src/db/schema.js';
import type { PrDetail, PrMeta } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const meta = (number: number): PrMeta => ({
  number,
  title: `PR ${number}`,
  author: 'octocat',
  branch: 'feat/x',
  base: 'main',
  head_sha: `sha${number}`,
  additions: 3,
  deletions: 1,
  files_count: 1,
  status: 'open',
  opened_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T03:00:00Z',
});

let seq = 0;

d('PullsService (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function setup(gh: MockGitHubClient | null) {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: gh ? { github: gh } : undefined,
    });
    const name = `svc-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    return { app, service: new PullsService(app.container), repo: repo! };
  }

  it('findOrSync syncs a missing PR from GitHub and fetches its files', async () => {
    const detail: Partial<PrDetail> = {
      files: [{ path: 'a.ts', additions: 2, deletions: 0, patch: '@@ -1 +1 @@\n+x' }],
    };
    const gh = new MockGitHubClient({ pulls: [meta(5), meta(6)], detail });
    const { service, repo } = await setup(gh);

    const pr = await service.findOrSync(workspaceId, repo, 5);
    expect(pr).not.toBeNull();
    expect(pr!.number).toBe(5);
    const files = await pg.handle.db.select().from(t.prFiles).where(eq(t.prFiles.prId, pr!.id));
    expect(files.map((f) => f.path)).toEqual(['a.ts']);
    // The whole list was imported (idempotent upsert).
    expect(await service.findByNumber(workspaceId, repo.id, 6)).toBeDefined();
  });

  it('findOrSync returns null when GitHub does not know the PR', async () => {
    const gh = new MockGitHubClient({ pulls: [meta(1)] });
    const { service, repo } = await setup(gh);
    expect(await service.findOrSync(workspaceId, repo, 999)).toBeNull();
  });

  it('findOrSync is scoped to the workspace', async () => {
    const gh = new MockGitHubClient({ pulls: [meta(5)] });
    const { service, repo } = await setup(gh);
    await service.findOrSync(workspaceId, repo, 5);
    expect(
      await service.findByNumber('00000000-0000-0000-0000-000000000000', repo.id, 5),
    ).toBeUndefined();
  });

  it('routes keep working: list + detail refresh persisted files', async () => {
    const detail: Partial<PrDetail> = {
      files: [{ path: 'b.ts', additions: 1, deletions: 1, patch: null }],
    };
    const gh = new MockGitHubClient({ pulls: [meta(9)], detail });
    const { app, repo } = await setup(gh);

    const list = await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` });
    expect(list.statusCode).toBe(200);
    const rows = list.json() as PrMeta[];
    expect(rows.map((r) => r.number)).toEqual([9]);
    expect(rows[0]!.score).toBeNull();
    expect(rows[0]!.findings).toBeNull();

    const res = await app.inject({ method: 'GET', url: `/pulls/${rows[0]!.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().files.map((f: { path: string }) => f.path)).toEqual(['b.ts']);
    const persisted = await pg.handle.db
      .select()
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, rows[0]!.id));
    expect(persisted).toHaveLength(1);
  });

  it('routes 404 for unknown repo / PR', async () => {
    const { app } = await setup(new MockGitHubClient());
    const missing = '00000000-0000-0000-0000-000000000000';
    expect((await app.inject({ method: 'GET', url: `/repos/${missing}/pulls` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/pulls/${missing}` })).statusCode).toBe(404);
  });
});
