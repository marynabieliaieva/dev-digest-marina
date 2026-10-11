import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { loadConfig } from '../src/platform/config.js';
import type { Container } from '../src/platform/container.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { ProjectContextService } from '../src/modules/project-context/service.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/**
 * Workspace-wide attached-document collector against a real Postgres and
 * tmp-dir clones: enabled agents only, enabled skill links only, first path
 * occurrence wins, per-document problems become statuses.
 */
d('ProjectContextService.collectWorkspaceDocs', () => {
  let pg: PgFixture;
  let svc: ProjectContextService;

  beforeAll(async () => {
    pg = await startPg();
    const db = pg.handle.db;
    const container = {
      db,
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      agentsRepo: new AgentsRepository(db),
    } as unknown as Container;
    svc = new ProjectContextService(container);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeClone(files: Record<string, string | Buffer>): string {
    const dir = mkdtempSync(join(tmpdir(), 'pctx-ws-'));
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    return dir;
  }

  async function newWorkspace(files: Record<string, string | Buffer> | null) {
    const db = pg.handle.db;
    const [ws] = await db
      .insert(t.workspaces)
      .values({ name: `ws-${Math.random().toString(36).slice(2, 8)}` })
      .returning();
    const name = `r-${Math.random().toString(36).slice(2, 8)}`;
    const [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId: ws!.id,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        clonePath: files ? makeClone(files) : null,
      })
      .returning();
    return { workspaceId: ws!.id, repoId: repo!.id };
  }

  async function addAgent(workspaceId: string, name: string, enabled: boolean, paths: string[]) {
    const db = pg.handle.db;
    const [agent] = await db
      .insert(t.agents)
      .values({ workspaceId, name, provider: 'openai', model: 'gpt-4.1', systemPrompt: 's', enabled })
      .returning();
    if (paths.length > 0) {
      await db
        .insert(t.agentContextDocs)
        .values(paths.map((path, order) => ({ agentId: agent!.id, path, order })));
    }
    return agent!;
  }

  async function addSkill(workspaceId: string, name: string, paths: string[]) {
    const db = pg.handle.db;
    const [skill] = await db
      .insert(t.skills)
      .values({ workspaceId, name, description: 'd', type: 'custom', source: 'manual', body: 'b' })
      .returning();
    await db
      .insert(t.skillContextDocs)
      .values(paths.map((path, order) => ({ skillId: skill!.id, path, order })));
    return skill!;
  }

  it('merges enabled agents and enabled skill links, first occurrence wins', async () => {
    const { workspaceId, repoId } = await newWorkspace({
      'specs/a.md': 'A',
      'specs/b.md': 'B',
      'specs/c.md': 'C',
    });
    const a = await addAgent(workspaceId, 'A', true, ['specs/a.md']);
    await addAgent(workspaceId, 'B', false, ['specs/b.md']);
    const s = await addSkill(workspaceId, 'S', ['specs/a.md', 'specs/c.md']);
    await pg.handle.db.insert(t.agentSkills).values({ agentId: a.id, skillId: s.id, order: 0 });

    const res = await svc.collectWorkspaceDocs(workspaceId, repoId);
    expect(res.clone).toBe(true);
    expect(res.docs.map((x) => x.path)).toEqual(['specs/a.md', 'specs/c.md']);
    expect(res.docs.every((x) => x.status === 'ok')).toBe(true);
    expect(res.docs[0]!.content).toBe('A');
  });

  it('ignores skills whose agent link is disabled', async () => {
    const { workspaceId, repoId } = await newWorkspace({ 'specs/a.md': 'A', 'specs/c.md': 'C' });
    const a = await addAgent(workspaceId, 'A', true, ['specs/a.md']);
    const s = await addSkill(workspaceId, 'S', ['specs/c.md']);
    await pg.handle.db
      .insert(t.agentSkills)
      .values({ agentId: a.id, skillId: s.id, order: 0, enabled: false });

    const res = await svc.collectWorkspaceDocs(workspaceId, repoId);
    expect(res.docs.map((x) => x.path)).toEqual(['specs/a.md']);
  });

  it('records statuses for missing, too large and unreadable documents', async () => {
    const { workspaceId, repoId } = await newWorkspace({
      'specs/big.md': Buffer.alloc(70_000, 'x'),
      'specs/ok.md': 'ok',
    });
    await addAgent(workspaceId, 'A', true, [
      'specs/ok.md',
      'specs/gone.md',
      'specs/big.md',
      'src/outside.md',
    ]);

    const res = await svc.collectWorkspaceDocs(workspaceId, repoId);
    const byPath = Object.fromEntries(res.docs.map((x) => [x.path, x]));
    expect(byPath['specs/ok.md']!.status).toBe('ok');
    expect(byPath['specs/gone.md']!.status).toBe('missing');
    expect(byPath['specs/gone.md']!.content).toBeNull();
    expect(byPath['specs/big.md']!.status).toBe('too_large');
    expect(byPath['specs/big.md']!.bytes).toBeGreaterThan(65_536);
    expect(byPath['src/outside.md']!.status).toBe('unreadable');
  });

  it('returns clone:false without throwing when the repo has no clone', async () => {
    const { workspaceId, repoId } = await newWorkspace(null);
    await addAgent(workspaceId, 'A', true, ['specs/a.md']);
    const res = await svc.collectWorkspaceDocs(workspaceId, repoId);
    expect(res).toEqual({ clone: false, docs: [] });
  });
});
