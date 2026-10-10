import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW: Review = {
  verdict: 'comment',
  summary: 'ok',
  score: 90,
  findings: [],
};

type TraceDoc = {
  specs_read: string[];
  project_context?: { path: string; status: string; origin: string; est_tokens: number }[];
  prompt_assembly: { specs: string | null; user: string };
  log: { msg: string }[];
};

/**
 * Run-executor project-context injection against a real Postgres, a tmp-dir
 * clone and a mocked LLM: the attached docs reach the prompt, statuses land in
 * the trace, and a bad document never fails the run.
 */
d('project-context in review runs', () => {
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

  function makeClone(files: Record<string, string | Buffer>): string {
    const dir = mkdtempSync(join(tmpdir(), 'pctx-run-'));
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    return dir;
  }

  async function setup(files: Record<string, string | Buffer>) {
    const name = `ctx-run-${Math.random().toString(36).slice(2, 8)}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        clonePath: makeClone(files),
      })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'Add rate limiting',
        author: 'someone',
        branch: 'feat/x',
        base: 'main',
        headSha: 'abc123',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: 'body',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    return { pr: pr! };
  }

  function makeApp(llm: MockLLMProvider) {
    return buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: llm },
      },
    });
  }

  async function runWith(files: Record<string, string | Buffer>, attach: string[]) {
    const llm = new MockLLMProvider('openai', { structured: REVIEW });
    const app = await makeApp(llm);
    const { pr } = await setup(files);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `A-${Math.random()}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    if (attach.length > 0) {
      const put = await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/context`,
        payload: { paths: attach },
      });
      expect(put.statusCode).toBe(200);
    }
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const runId = res.json().runs[0].run_id as string;

    // Poll for the trace itself — the run is marked terminal before it is saved.
    let trace: TraceDoc | undefined;
    for (let i = 0; i < 400 && !trace; i++) {
      const r = await app.inject({ method: 'GET', url: `/runs/${runId}/trace` });
      if (r.statusCode === 200) trace = r.json() as TraceDoc;
      else await new Promise((ok) => setTimeout(ok, 25));
    }
    expect(trace).toBeDefined();
    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    await app.close();
    return { trace: trace!, run: run!, llm };
  }

  const userText = (llm: MockLLMProvider) =>
    llm.calls
      .filter((c) => c.method === 'completeStructured')
      .map((c) =>
        (c.req as { messages: { role: string; content: string }[] }).messages
          .map((m) => m.content)
          .join('\n'),
      )
      .join('\n');

  it('injects an attached doc from the PR repo clone and records specs_read', async () => {
    const { trace, run, llm } = await runWith({ 'specs/x.md': '# X\nUNIQUE-SPEC-BODY\n' }, ['specs/x.md']);
    expect(run.status).toBe('done');
    const text = userText(llm);
    expect(text).toContain('<untrusted source="specs/x.md">');
    expect(text).toContain('UNIQUE-SPEC-BODY');
    expect(trace.specs_read).toEqual(['specs/x.md']);
    expect(trace.project_context).toEqual([
      expect.objectContaining({ path: 'specs/x.md', origin: 'agent', status: 'included' }),
    ]);
    expect(trace.prompt_assembly.specs).toContain('UNIQUE-SPEC-BODY');
    expect(trace.log.some((l) => /^project context: 1 of 1 document\(s\) attached, ≈\d+ tokens$/.test(l.msg))).toBe(
      true,
    );
  });

  it('a missing attached doc is recorded as missing and the run stays done', async () => {
    const { trace, run } = await runWith({ 'specs/other.md': '# o\n' }, ['specs/gone.md']);
    expect(run.status).toBe('done');
    expect(trace.project_context).toContainEqual({
      path: 'specs/gone.md',
      status: 'missing',
      origin: 'agent',
      est_tokens: 0,
    });
    expect(trace.specs_read).toEqual([]);
    expect(trace.log.some((l) => l.msg === 'project context: skipped specs/gone.md — missing')).toBe(true);
  });

  it('a 70,000-byte doc is too_large and absent from the prompt', async () => {
    const big = `BIGDOC-MARKER\n${'a'.repeat(70_000)}`;
    const { trace, run, llm } = await runWith({ 'specs/big.md': big }, ['specs/big.md']);
    expect(run.status).toBe('done');
    expect(trace.project_context).toContainEqual(
      expect.objectContaining({ path: 'specs/big.md', status: 'too_large' }),
    );
    expect(trace.prompt_assembly.user).not.toContain('BIGDOC-MARKER');
    expect(userText(llm)).not.toContain('BIGDOC-MARKER');
    expect(trace.log.some((l) => l.msg === 'project context: skipped specs/big.md — too_large')).toBe(true);
  });

  it('an invalid-UTF-8 doc is unreadable and the run stays done', async () => {
    const { trace, run } = await runWith(
      { 'specs/bad.md': Buffer.from([0x23, 0x20, 0xff, 0xfe, 0xc3, 0x28, 0x0a]) },
      ['specs/bad.md'],
    );
    expect(run.status).toBe('done');
    expect(trace.project_context).toContainEqual(
      expect.objectContaining({ path: 'specs/bad.md', status: 'unreadable' }),
    );
    expect(trace.log.some((l) => l.msg === 'project context: skipped specs/bad.md — unreadable')).toBe(true);
  });

  it('attaching docs does not change the number of LLM calls', async () => {
    const files = { 'specs/a.md': '# a\n', 'specs/b.md': '# b\n', 'docs/c.md': '# c\n' };
    const withDocs = await runWith(files, ['specs/a.md', 'specs/b.md', 'docs/c.md']);
    const without = await runWith(files, []);
    expect(withDocs.llm.calls.length).toBe(without.llm.calls.length);
    expect(withDocs.llm.calls.length).toBeGreaterThan(0);
  });

  it('an agent with no attachments gets no context log line, null specs and empty specs_read', async () => {
    const { trace, run } = await runWith({ 'specs/a.md': '# a\n' }, []);
    expect(run.status).toBe('done');
    expect(trace.log.some((l) => l.msg.startsWith('project context:'))).toBe(false);
    expect(trace.prompt_assembly.specs).toBeNull();
    expect(trace.specs_read).toEqual([]);
  });
});
