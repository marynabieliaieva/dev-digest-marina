/**
 * GET /pulls/:id/blast + GET /pulls/resolve — Blast Radius served from a stubbed
 * repo-intel facade over a real Postgres. Gated on Docker like other .it tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import { BlastRadiusResponse } from '@devdigest/shared';
import { BlastService } from '../src/modules/blast/service.js';
import { BlastRepository } from '../src/modules/blast/repository.js';
import type {
  BlastResult,
  IndexResult,
  IndexState,
  RepoIntel,
  RepoMapResult,
} from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

class StubRepoIntel implements RepoIntel {
  blastCalls: Array<{ repoId: string; files: string[] }> = [];
  stateCalls = 0;
  constructor(
    private blast: BlastResult,
    private stateOver: Partial<IndexState> = {},
  ) {}
  async indexRepo(): Promise<IndexResult> {
    return { status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 };
  }
  async refreshIndex(): Promise<IndexResult> {
    return this.indexRepo();
  }
  async getIndexState(repoId: string): Promise<IndexState> {
    this.stateCalls++;
    return {
      repoId,
      status: 'full',
      filesIndexed: 1,
      filesSkipped: 0,
      durationMs: 0,
      lastIndexedSha: 'indexed-sha',
      indexerVersion: 1,
      updatedAt: new Date(0),
      ...this.stateOver,
    };
  }
  async getBlastRadius(repoId: string, files: string[]): Promise<BlastResult> {
    this.blastCalls.push({ repoId, files });
    return this.blast;
  }
  async getRepoMap(): Promise<RepoMapResult> {
    return { text: '', tokens: 0, cached: true };
  }
  async getFileRank() {
    return [];
  }
  async getSymbolsInFiles() {
    return [];
  }
  async getCallerSignatures() {
    return [];
  }
  async getUnresolvedReferences() {
    return [];
  }
  async getConventionSamples(): Promise<string[]> {
    return [];
  }
  async getTopFilesByRank() {
    return [];
  }
  async getCriticalPaths() {
    return [];
  }
}

const healthy: BlastResult = {
  changedSymbols: [{ name: 'foo', file: 'src/foo.ts', kind: 'function' }],
  callers: [
    { file: 'src/api.ts', symbol: 'handler', viaSymbol: 'foo', line: 7, rank: 3 },
    { file: 'src/foo.ts', symbol: 'self', viaSymbol: 'foo', line: 1, rank: 9 },
  ],
  impactedEndpoints: [],
  factsByFile: { 'src/api.ts': { endpoints: ['GET /foo'], crons: ['nightly'] } },
};

let seq = 0;
const MISSING = '00000000-0000-0000-0000-000000000000';

d('blast radius (Testcontainers pg)', () => {
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

  function makeApp(intel: RepoIntel) {
    return buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: { repoIntel: intel, github: new MockGitHubClient({ pulls: [] }) },
    });
  }

  async function seedPr(wsId = workspaceId, paths = ['src/zeta.ts', 'src/alpha.ts']) {
    const db = pg.handle.db;
    const name = `blast-${seq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: wsId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: wsId,
        repoId: repo!.id,
        number: 21,
        title: 'T',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'head',
        additions: 1,
        deletions: 0,
        filesCount: paths.length,
        status: 'needs_review',
      })
      .returning();
    await db.insert(t.prFiles).values(paths.map((path) => ({ prId: pr!.id, path })));
    return { repo: repo!, pr: pr! };
  }

  it('serves a contract-valid blast, calling repo-intel exactly once with the PR paths', async () => {
    const intel = new StubRepoIntel(healthy);
    const app = await makeApp(intel);
    const { repo, pr } = await seedPr();

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = BlastRadiusResponse.parse(res.json());
    expect(body).toMatchObject({
      pr_id: pr.id,
      indexed_sha: 'indexed-sha',
      index_status: 'full',
      degraded: false,
      reason: null,
    });
    // declaring-file caller dropped; endpoint + cron attributed from facts
    expect(body.blast.downstream).toEqual([
      {
        symbol: 'foo',
        callers: [{ name: 'handler', file: 'src/api.ts', line: 7 }],
        endpoints_affected: ['GET /foo'],
        crons_affected: ['nightly'],
      },
    ]);
    expect(intel.blastCalls).toEqual([{ repoId: repo.id, files: ['src/alpha.ts', 'src/zeta.ts'] }]);
    expect(intel.stateCalls).toBe(1);
    await app.close();
  });

  it('returns 404 for a foreign-workspace PR and an unknown id, 422 for a non-uuid', async () => {
    const intel = new StubRepoIntel(healthy);
    const app = await makeApp(intel);
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'other' }).returning();
    const foreign = await seedPr(other!.id);

    expect((await app.inject({ method: 'GET', url: `/pulls/${foreign.pr.id}/blast` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/pulls/${MISSING}/blast` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/blast' })).statusCode).toBe(422);
    // never reached the facade for any of them
    expect(intel.blastCalls).toEqual([]);
    await app.close();
  });

  it('degraded result: degraded true, indexed_sha null, non-null reason', async () => {
    const intel = new StubRepoIntel(
      { changedSymbols: [], callers: [], impactedEndpoints: [], degraded: true, reason: 'no_data' },
      { status: 'degraded' },
    );
    const app = await makeApp(intel);
    const { pr } = await seedPr();

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = BlastRadiusResponse.parse(res.json());
    expect(body.degraded).toBe(true);
    expect(body.indexed_sha).toBeNull();
    expect(body.reason).not.toBeNull();
    expect(body.index_status).toBe('degraded');
    await app.close();
  });

  it('logs { index_status, changed_files, callers } once via the injected logger', async () => {
    const intel = new StubRepoIntel(healthy);
    const logs: Array<{ obj: object; msg?: string }> = [];
    const service = new BlastService(
      new BlastRepository(pg.handle.db),
      intel,
      () => true,
      { info: (obj, msg) => void logs.push({ obj, msg }) },
    );
    const { pr } = await seedPr();

    await service.getBlast(workspaceId, pr.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.obj).toEqual({ index_status: 'full', changed_files: 2, callers: 1 });
  });

  it('GET /pulls/resolve returns 200 { id } (not shadowed by /pulls/:id); 404 unknown repo; 422 missing pr', async () => {
    const app = await makeApp(new StubRepoIntel(healthy));
    const { repo, pr } = await seedPr();

    const ok = await app.inject({
      method: 'GET',
      url: `/pulls/resolve?repo=${encodeURIComponent(repo.fullName)}&pr=${pr.number}`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ id: pr.id });

    const unknownRepo = await app.inject({ method: 'GET', url: '/pulls/resolve?repo=nobody%2Fnothing&pr=1' });
    expect(unknownRepo.statusCode).toBe(404);

    const missingPr = await app.inject({
      method: 'GET',
      url: `/pulls/resolve?repo=${encodeURIComponent(repo.fullName)}`,
    });
    expect(missingPr.statusCode).toBe(422);

    // PR number unknown to DB and GitHub mock
    const unknownPr = await app.inject({
      method: 'GET',
      url: `/pulls/resolve?repo=${encodeURIComponent(repo.fullName)}&pr=999`,
    });
    expect(unknownPr.statusCode).toBe(404);
    await app.close();
  });

  it('GET /pulls/resolve does not leak a PR from a foreign workspace', async () => {
    const app = await makeApp(new StubRepoIntel(healthy));
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'other2' }).returning();
    const foreign = await seedPr(other!.id);

    const res = await app.inject({
      method: 'GET',
      url: `/pulls/resolve?repo=${encodeURIComponent(foreign.repo.fullName)}&pr=${foreign.pr.number}`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
