/**
 * GET /repos/resolve — owner/name | bare name → { id, full_name }; 404 when the
 * repo isn't added, 409 (with candidates) when a bare name is ambiguous.
 * Gated on Docker (Postgres), like the other integration tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('GET /repos/resolve (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    const workspaceId = ws!.id;
    for (const [owner, name] of [
      ['octocat', 'resolve-hello'],
      ['octocat', 'resolve-dup'],
      ['other', 'resolve-dup'],
    ] as const) {
      const [row] = await pg.handle.db
        .insert(t.repos)
        .values({ workspaceId, owner, name, fullName: `${owner}/${name}` })
        .returning();
      ids[`${owner}/${name}`] = row!.id;
    }
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient() },
    });
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const resolve = (repo: string) =>
    app.inject({ method: 'GET', url: `/repos/resolve?repo=${encodeURIComponent(repo)}` });

  it('resolves owner/name', async () => {
    const res = await resolve('octocat/resolve-hello');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: ids['octocat/resolve-hello'],
      full_name: 'octocat/resolve-hello',
    });
  });

  it('resolves an unambiguous bare name, case-insensitively', async () => {
    const res = await resolve('Resolve-Hello');
    expect(res.statusCode).toBe(200);
    expect(res.json().full_name).toBe('octocat/resolve-hello');
  });

  it('404s when the repo is not added', async () => {
    const res = await resolve('nobody/missing');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toContain('not added to devdigest');
  });

  it('409s on an ambiguous bare name and lists owner/name candidates', async () => {
    const res = await resolve('resolve-dup');
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.message).toContain('octocat/resolve-dup');
    expect(body.error.message).toContain('other/resolve-dup');
  });

  it('treats LIKE wildcards literally', async () => {
    const res = await resolve('%');
    expect(res.statusCode).toBe(404);
  });

  it('rejects an empty repo param', async () => {
    const res = await app.inject({ method: 'GET', url: '/repos/resolve?repo=' });
    expect(res.statusCode).toBe(422);
  });
});
