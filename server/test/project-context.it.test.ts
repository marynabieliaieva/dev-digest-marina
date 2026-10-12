import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context] Docker not available — skipping integration tests.');
}

/**
 * Project-context module against a real Postgres and a tmp-dir clone:
 * listing/preview rules, attachment persistence (order, no version bump),
 * used-by counts, inherited rows and cascade deletes.
 */
d('project-context module', () => {
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

  function makeClone(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'pctx-repo-'));
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    return dir;
  }

  const BASE_FILES: Record<string, string> = {
    'specs/a.md': '# A\n',
    'docs/x/b.md': '# B\n',
    'insights/c.md': '# C\n',
    'src/readme.md': '# not matched\n',
    'specs/d.txt': 'not markdown',
    'node_modules/pkg/specs/skip.md': '# skipped\n',
    'adr/0001.md': '# adr\n',
  };

  async function makeRepo(clonePath: string | null) {
    const name = `ctx-${Math.random().toString(36).slice(2, 8)}`;
    const [r] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();
    return r!.id as string;
  }

  async function makeAgent(name?: string) {
    const [a] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: name ?? `agent-${Math.random().toString(36).slice(2, 8)}`,
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'review',
      })
      .returning();
    return a!;
  }

  async function makeSkill(enabled = true) {
    const [s] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name: `skill-${Math.random().toString(36).slice(2, 8)}`,
        description: 'd',
        type: 'custom',
        source: 'manual',
        body: 'body',
        enabled,
      })
      .returning();
    return s!;
  }

  function makeApp(globs?: string) {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      ...(globs ? { PROJECT_CONTEXT_GLOBS: globs } : {}),
    } as NodeJS.ProcessEnv);
    return buildApp({ config, db: pg.handle.db });
  }

  it('lists exactly the default-glob documents and echoes the roots', async () => {
    const repoId = await makeRepo(makeClone(BASE_FILES));
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.roots).toEqual(['**/{specs,docs,insights}/**/*.md']);
    expect(body.docs.map((x: { path: string }) => x.path)).toEqual([
      'docs/x/b.md',
      'insights/c.md',
      'specs/a.md',
    ]);
    expect(body.docs[2]).toMatchObject({
      type: 'specs',
      est_tokens: 1,
      used_by_agents: 0,
      used_by: [],
    });
  });

  it('honours a custom glob config', async () => {
    const repoId = await makeRepo(makeClone(BASE_FILES));
    const app = await makeApp('**/adr/**/*.md');
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    expect(res.statusCode).toBe(200);
    expect(res.json().roots).toEqual(['**/adr/**/*.md']);
    expect(res.json().docs.map((x: { path: string }) => x.path)).toEqual(['adr/0001.md']);
  });

  it('rescans on every request (a new file shows up without any refresh step)', async () => {
    const dir = makeClone(BASE_FILES);
    const repoId = await makeRepo(dir);
    const app = await makeApp();
    const first = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    writeFileSync(join(dir, 'specs', 'new.md'), '# new\n');
    const second = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    expect(second.json().docs.length).toBe(first.json().docs.length + 1);
  });

  it('returns 409 context_unavailable for a repo without a clone', async () => {
    const repoId = await makeRepo(null);
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('context_unavailable');
  });

  it('returns 409 when the clone directory is gone', async () => {
    const repoId = await makeRepo(join(tmpdir(), 'pctx-does-not-exist-xyz'));
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('context_unavailable');
  });

  it('serves a document and rejects unsafe or out-of-glob paths', async () => {
    const repoId = await makeRepo(makeClone(BASE_FILES));
    const app = await makeApp();
    const file = (path: string) =>
      app.inject({
        method: 'GET',
        url: `/repos/${repoId}/context/file?path=${encodeURIComponent(path)}`,
      });

    const ok = await file('specs/a.md');
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ path: 'specs/a.md', content: '# A\n' });

    for (const bad of ['../../etc/passwd', '/etc/passwd', 'src/a.ts', 'specs/../src/a.md']) {
      const res = await file(bad);
      expect(res.statusCode, bad).toBe(400);
      expect(res.json().error.code, bad).toBe('invalid_path');
    }

    const absent = await file('specs/nope.md');
    expect(absent.statusCode).toBe(404);
    expect(absent.json().error.code).toBe('not_found');
  });

  it('returns 404 for an unknown repo', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: '/repos/00000000-0000-4000-8000-000000000000/context',
    });
    expect(res.statusCode).toBe(404);
  });

  it('persists agent attachments in order without bumping the agent version', async () => {
    const agent = await makeAgent();
    const app = await makeApp();
    const put = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { paths: ['specs/b.md', 'specs/a.md'] },
    });
    expect(put.statusCode).toBe(200);

    const rows = await pg.handle.db
      .select()
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.agentId, agent.id));
    expect(rows.sort((x, y) => x.order - y.order).map((r) => r.path)).toEqual([
      'specs/b.md',
      'specs/a.md',
    ]);

    const get = await app.inject({ method: 'GET', url: `/agents/${agent.id}/context` });
    expect(get.json()).toEqual({ paths: ['specs/b.md', 'specs/a.md'], inherited: [] });

    const [after] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.id, agent.id));
    expect(after!.version).toBe(agent.version);
    const versions = await pg.handle.db
      .select()
      .from(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agent.id));
    expect(versions).toHaveLength(0);
  });

  it('rejects bad attachment lists with 400 invalid_path', async () => {
    const agent = await makeAgent();
    const app = await makeApp();
    const put = (paths: string[]) =>
      app.inject({ method: 'PUT', url: `/agents/${agent.id}/context`, payload: { paths } });

    for (const paths of [['../x.md'], ['specs/a.md', 'specs/a.md'], ['a.txt']]) {
      const res = await put(paths);
      expect(res.statusCode, paths.join()).toBe(400);
      expect(res.json().error.code).toBe('invalid_path');
    }
    const tooMany = await put(Array.from({ length: 101 }, (_, i) => `specs/${i}.md`));
    expect(tooMany.statusCode).toBe(400);
  });

  it('returns 404 for an unknown agent or skill', async () => {
    const app = await makeApp();
    const zero = '00000000-0000-4000-8000-000000000000';
    expect((await app.inject({ method: 'GET', url: `/agents/${zero}/context` })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'PUT', url: `/skills/${zero}/context`, payload: { paths: [] } }))
        .statusCode,
    ).toBe(404);
  });

  it('persists skill attachments without a version bump or new skill_versions row', async () => {
    const skill = await makeSkill();
    const app = await makeApp();
    const put = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}/context`,
      payload: { paths: ['specs/s1.md', 'docs/s2.md'] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ paths: ['specs/s1.md', 'docs/s2.md'] });

    const get = await app.inject({ method: 'GET', url: `/skills/${skill.id}/context` });
    expect(get.json()).toEqual({ paths: ['specs/s1.md', 'docs/s2.md'] });

    const [after] = await pg.handle.db.select().from(t.skills).where(eq(t.skills.id, skill.id));
    expect(after!.version).toBe(skill.version);
    const versions = await pg.handle.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skill.id));
    expect(versions).toHaveLength(0);
  });

  it('counts direct and via-skill usage in used_by_agents and drops it when the link is disabled', async () => {
    const dir = makeClone({ 'specs/usage-shared.md': '# shared\n' });
    const repoId = await makeRepo(dir);
    const agentA = await makeAgent('usage-agent-a');
    const agentB = await makeAgent('usage-agent-b');
    const skill = await makeSkill();
    const app = await makeApp();

    await app.inject({
      method: 'PUT',
      url: `/agents/${agentA.id}/context`,
      payload: { paths: ['specs/usage-shared.md'] },
    });
    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}/context`,
      payload: { paths: ['specs/usage-shared.md'] },
    });
    await pg.handle.db.insert(t.agentSkills).values({ agentId: agentB.id, skillId: skill.id, order: 0 });

    const list = async () => {
      const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
      return res.json().docs[0] as { used_by_agents: number; used_by: { id: string; name: string }[] };
    };

    const both = await list();
    expect(both.used_by_agents).toBe(2);
    expect(both.used_by.map((u) => u.name).sort()).toEqual(['usage-agent-a', 'usage-agent-b']);

    await pg.handle.db
      .update(t.agentSkills)
      .set({ enabled: false })
      .where(eq(t.agentSkills.agentId, agentB.id));
    const one = await list();
    expect(one.used_by_agents).toBe(1);
    expect(one.used_by[0]!.name).toBe('usage-agent-a');
  });

  it('reports inherited paths from enabled linked skills, direct attachment winning', async () => {
    const agent = await makeAgent();
    const skill = await makeSkill();
    const disabled = await makeSkill(false);
    const app = await makeApp();

    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}/context`,
      payload: { paths: ['specs/a.md', 'specs/inherited.md'] },
    });
    await app.inject({
      method: 'PUT',
      url: `/skills/${disabled.id}/context`,
      payload: { paths: ['specs/from-disabled.md'] },
    });
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { paths: ['specs/a.md'] },
    });
    await pg.handle.db.insert(t.agentSkills).values([
      { agentId: agent.id, skillId: skill.id, order: 0 },
      { agentId: agent.id, skillId: disabled.id, order: 1 },
    ]);

    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/context` });
    expect(res.json()).toEqual({
      paths: ['specs/a.md'],
      inherited: [{ path: 'specs/inherited.md', skill_id: skill.id, skill_name: skill.name }],
    });
  });

  it('removes attachment rows when the agent or skill is deleted', async () => {
    const agent = await makeAgent();
    const skill = await makeSkill();
    const app = await makeApp();
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { paths: ['specs/a.md'] },
    });
    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}/context`,
      payload: { paths: ['specs/a.md'] },
    });

    await pg.handle.db.delete(t.agents).where(eq(t.agents.id, agent.id));
    await pg.handle.db.delete(t.skills).where(eq(t.skills.id, skill.id));

    expect(
      await pg.handle.db
        .select()
        .from(t.agentContextDocs)
        .where(eq(t.agentContextDocs.agentId, agent.id)),
    ).toHaveLength(0);
    expect(
      await pg.handle.db
        .select()
        .from(t.skillContextDocs)
        .where(eq(t.skillContextDocs.skillId, skill.id)),
    ).toHaveLength(0);
  });
});
