import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import type {
  BlastResult,
  IndexResult,
  IndexState,
  RepoIntel,
  RepoMapResult,
} from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

/** Everything but getConventionSamples/getRepoMap is unused by this pipeline;
 *  stubbed to the same degraded defaults the real facade returns when off. */
class StubRepoIntel implements RepoIntel {
  constructor(private samples: string[]) {}
  async indexRepo(): Promise<IndexResult> {
    return { status: 'degraded', filesIndexed: 0, filesSkipped: 0, durationMs: 0 };
  }
  async refreshIndex(): Promise<IndexResult> {
    return this.indexRepo();
  }
  async getIndexState(repoId: string): Promise<IndexState> {
    return {
      repoId,
      status: 'degraded',
      filesIndexed: 0,
      filesSkipped: 0,
      durationMs: 0,
      lastIndexedSha: '',
      indexerVersion: 1,
      updatedAt: new Date(0),
      degraded: true,
    };
  }
  async getBlastRadius(): Promise<BlastResult> {
    return { changedSymbols: [], callers: [], impactedEndpoints: [], degraded: true };
  }
  async getRepoMap(): Promise<RepoMapResult> {
    return { text: 'src/service.ts (core)', tokens: 5, cached: true };
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
    return this.samples;
  }
  async getTopFilesByRank() {
    return [];
  }
  async getCriticalPaths() {
    return [];
  }
}

/**
 * The conventions pipeline end to end against a real clone dir + mock LLM:
 * extract → list → PATCH accept/reject/edit → POST skill → the skill shows up
 * in GET /skills with skill_id stamped back and an optional agent link.
 */
d('conventions module', () => {
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

  function makeClone(): string {
    const dir = mkdtempSync(join(tmpdir(), 'conv-repo-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ scripts: { build: 'tsc' }, dependencies: { zod: '^3.0.0' } }),
    );
    writeFileSync(
      join(dir, 'src', 'service.ts'),
      ['export class FooService {', '  constructor() {}', '}', ''].join('\n'),
    );
    return dir;
  }

  async function makeRepo(clonePath: string) {
    const name = `widgets-${Math.random().toString(36).slice(2, 8)}`;
    const [r] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();
    return r!.id as string;
  }

  function makeApp(llm: MockLLMProvider, repoIntel: RepoIntel) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { llm: { openai: llm }, repoIntel },
    });
  }

  const fixture = {
    ConventionFileSelection: {
      files: [{ path: 'src/service.ts', reason: 'core service naming pattern' }],
    },
    ConventionExtraction: {
      conventions: [
        {
          category: 'naming',
          rule: 'Service classes are suffixed with Service.',
          evidence: { path: 'src/service.ts', line: 1, snippet: 'export class FooService' },
          confidence: 0.92,
        },
      ],
    },
  };

  it('extracts, grounds, and lists candidates for the latest scan', async () => {
    const clonePath = makeClone();
    const repoId = await makeRepo(clonePath);
    const llm = new MockLLMProvider('openai', { structuredBySchema: fixture });
    const app = await makeApp(llm, new StubRepoIntel(['src/service.ts']));

    const started = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    expect(started.statusCode).toBe(202);
    const { extractionId } = started.json();
    expect(extractionId).toBeTruthy();

    await app.container.jobs.onIdle();

    const page = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
    expect(page.statusCode).toBe(200);
    const body = page.json();
    expect(body.extraction).toMatchObject({ id: extractionId, status: 'done', candidates_kept: 1 });
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({
      category: 'naming',
      status: 'pending',
      evidence_path: 'src/service.ts',
      evidence_line: 1,
    });

    // Both structured calls actually happened, keyed by schemaName.
    const schemaNames = llm.calls
      .filter((c) => c.method === 'completeStructured')
      .map((c) => (c.req as { schemaName: string }).schemaName);
    expect(schemaNames).toEqual(['ConventionFileSelection', 'ConventionExtraction']);
  });

  it('degrades to a done, zero-candidate extraction when the repo has no clone', async () => {
    const [r] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'unindexed', fullName: 'acme/unindexed' })
      .returning();
    const repoId = r!.id;
    const llm = new MockLLMProvider('openai', { structuredBySchema: fixture });
    const app = await makeApp(llm, new StubRepoIntel([]));

    await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    await app.container.jobs.onIdle();

    const page = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
    expect(page.json().extraction).toMatchObject({ status: 'done', candidates_kept: 0 });
    expect(page.json().candidates).toEqual([]);
    // No clone to read → never even calls the model.
    expect(llm.calls).toEqual([]);
  });

  it('accept/reject/edit a candidate, then merge accepted ones into a skill', async () => {
    const clonePath = makeClone();
    const repoId = await makeRepo(clonePath);
    const llm = new MockLLMProvider('openai', { structuredBySchema: fixture });
    const app = await makeApp(llm, new StubRepoIntel(['src/service.ts']));

    await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    await app.container.jobs.onIdle();
    const candidate = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json()
      .candidates[0];

    const accepted = await app.inject({
      method: 'PATCH',
      url: `/conventions/${candidate.id}`,
      payload: { status: 'accepted' },
    });
    expect(accepted.json()).toMatchObject({ status: 'accepted', edited: false });

    const edited = await app.inject({
      method: 'PATCH',
      url: `/conventions/${candidate.id}`,
      payload: { rule: 'Service classes MUST be suffixed with Service.' },
    });
    expect(edited.json()).toMatchObject({ edited: true });

    const preview = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/skill-preview`,
      payload: { candidate_ids: [candidate.id] },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().body).toContain('Service classes MUST be suffixed with Service.');
    expect(preview.json().name).toMatch(/^widgets-.*-conventions$/);

    const created = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/skill`,
      payload: {
        name: preview.json().name,
        description: preview.json().description,
        type: preview.json().type,
        body: preview.json().body,
        enabled: true,
        candidate_ids: [candidate.id],
      },
    });
    expect(created.statusCode).toBe(201);
    const skill = created.json();
    expect(skill.source).toBe('extracted');
    expect(skill.enabled).toBe(true);

    const skillsList = await app.inject({ method: 'GET', url: '/skills' });
    expect(skillsList.json().some((s: { id: string }) => s.id === skill.id)).toBe(true);

    const stamped = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
    expect(stamped.json().candidates[0]).toMatchObject({ skill_id: skill.id });
  });

  it('links the created skill to an agent when agent_id is passed', async () => {
    const clonePath = makeClone();
    const repoId = await makeRepo(clonePath);
    const llm = new MockLLMProvider('openai', { structuredBySchema: fixture });
    const app = await makeApp(llm, new StubRepoIntel(['src/service.ts']));

    await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    await app.container.jobs.onIdle();
    const candidate = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json()
      .candidates[0];
    await app.inject({
      method: 'PATCH',
      url: `/conventions/${candidate.id}`,
      payload: { status: 'accepted' },
    });

    const agent = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: `Conventions agent ${Math.random().toString(36).slice(2, 8)}`,
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review the diff.',
      },
    });
    const agentId = agent.json().id;

    const preview = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/skill-preview`,
      payload: { candidate_ids: [candidate.id] },
    });

    const created = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/skill`,
      payload: {
        name: preview.json().name,
        description: preview.json().description,
        type: preview.json().type,
        body: preview.json().body,
        enabled: true,
        candidate_ids: [candidate.id],
        agent_id: agentId,
      },
    });
    expect(created.statusCode).toBe(201);

    const links = await app.inject({ method: 'GET', url: `/agents/${agentId}/skills` });
    expect(links.json()).toHaveLength(1);
    expect(links.json()[0].skill.id).toBe(created.json().id);
  });
});
