import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockLLMProvider,
  MockGitHubClient,
  MockWebFetcher,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import { IntentService } from '../src/modules/intent/service.js';
import type { IntentLog } from '../src/modules/intent/helpers.js';
import * as t from '../src/db/schema.js';
import type { PrIntentResponse } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[intent] Docker not available — skipping integration tests.');
}

const config = (env: Record<string, string> = {}) =>
  loadConfig({ ...process.env, NODE_ENV: 'test', ...env } as NodeJS.ProcessEnv);

const DIFF_SENTINEL = 'SENTINEL_DIFF_BODY_7f3a';
const BODY_SENTINEL = 'BODY_SENTINEL_55e1';
const PLAN_MARKER = 'PLAN_MARKER_91c2';
const HEADER = '@@ -10,3 +10,4 @@ function boot()';
const PATCH = `${HEADER}\n   port: 3000,\n+  const ${DIFF_SENTINEL} = 1;\n   redisUrl: x,`;

const CLASSIFICATION = {
  summary: 'Adds rate limiting to the public API.',
  in_scope: ['rate limiter middleware'],
  out_of_scope: ['billing changes'],
  risk_areas: ['throughput'],
  confidence: 'high',
  missing_context: [],
};

d('intent module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function mocks(opts: { fixture?: unknown; files?: Record<string, string>; fetchError?: string } = {}) {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { IntentClassification: opts.fixture ?? CLASSIFICATION },
    });
    const github = new MockGitHubClient({ files: opts.files ?? {} });
    const web = new MockWebFetcher({ text: 'EXTERNAL_DOC_TEXT' }, opts.fetchError);
    return { llm, github, web };
  }

  async function makeApp(m: ReturnType<typeof mocks>, env: Record<string, string> = {}) {
    return buildApp({
      config: config(env),
      db: pg.handle.db,
      overrides: {
        llm: { openrouter: m.llm },
        github: m.github,
        webFetcher: m.web,
        secrets: new MockSecretsProvider({}),
      },
    });
  }

  async function setupPr(over: { body?: string | null; headSha?: string } = {}) {
    const name = `intent-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 100 + seq,
        title: 'Add rate limiting',
        author: 'dev',
        branch: 'feat/rl',
        base: 'main',
        headSha: over.headSha ?? 'aaaaaaa1111',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: over.body === undefined ? `A change. ${BODY_SENTINEL}` : over.body,
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: PATCH,
    });
    return pr!;
  }

  const structuredCalls = (llm: MockLLMProvider) =>
    llm.calls.filter((c) => c.method === 'completeStructured').map((c) => c.req as Record<string, unknown>);
  const lastReq = (llm: MockLLMProvider) => structuredCalls(llm).at(-1)!;

  const get = async (app: Awaited<ReturnType<typeof makeApp>>, id: string) =>
    app.inject({ method: 'GET', url: `/pulls/${id}/intent` });
  const derive = async (app: Awaited<ReturnType<typeof makeApp>>, id: string) =>
    app.inject({ method: 'POST', url: `/pulls/${id}/intent/derive` });

  it('1. GET: null when never derived; 404 unknown PR; 422 non-uuid', async () => {
    const app = await makeApp(mocks());
    const pr = await setupPr();
    const res = await get(app, pr.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pr_id: pr.id, current_head_sha: 'aaaaaaa1111', intent: null });

    expect((await get(app, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await derive(app, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    // The app's validation envelope maps a bad param to 422 (not 400).
    expect((await get(app, 'not-a-uuid')).statusCode).toBe(422);
    await app.close();
  });

  it('2. V4/R7: a linked plan and issue are fetched, recorded and sent to the classifier', async () => {
    const m = mocks({ files: { 'docs/plans/foo.md': `# Plan\n${PLAN_MARKER}` } });
    const app = await makeApp(m);
    const pr = await setupPr({ body: `Fixes #12\nPlan: docs/plans/foo.md\n${BODY_SENTINEL}` });
    const res = await derive(app, pr.id);
    expect(res.statusCode).toBe(200);
    const body = res.json() as PrIntentResponse;
    expect(body.intent!.status).toBe('ready');
    expect(body.intent!.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'repo_doc', ref: 'docs/plans/foo.md', status: 'used' }),
        expect.objectContaining({ kind: 'linked_issue', ref: '#12', status: 'used' }),
      ]),
    );
    expect(JSON.stringify((lastReq(m.llm) as { messages: unknown }).messages)).toContain(PLAN_MARKER);
    await app.close();
  });

  it('3. V3: no diff body in the classifier request, only path + hunk header; no tools', async () => {
    const m = mocks();
    const app = await makeApp(m);
    const pr = await setupPr();
    await derive(app, pr.id);
    const req = lastReq(m.llm);
    const messages = JSON.stringify(req.messages);
    expect(messages).not.toContain(DIFF_SENTINEL);
    expect(messages).toContain('src/config.ts');
    expect(messages).toContain(HEADER);
    expect('tools' in req).toBe(false);
    expect('tool_choice' in req).toBe(false);
    await app.close();
  });

  it('4. V2/R5: openrouter cheap model, requireParameters, and the settings override', async () => {
    const m = mocks();
    const app = await makeApp(m);
    const pr = await setupPr();
    await derive(app, pr.id);
    const req = lastReq(m.llm);
    expect(req.model).toBe('deepseek/deepseek-v4-flash');
    expect(req.requireParameters).toBe(true);
    expect(req.schemaName).toBe('IntentClassification');

    const put = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: { review_intent: { provider: 'openrouter', model: 'qwen/qwen3.5-flash-02-23' } } },
    });
    expect(put.statusCode).toBe(200);
    await derive(app, pr.id);
    expect(lastReq(m.llm).model).toBe('qwen/qwen3.5-flash-02-23');
    // restore the default for other tests sharing this workspace
    await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: { review_intent: { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' } } },
    });
    await app.close();
  });

  it('5. R7: unsupported / unavailable links are recorded, never invented, and cap confidence', async () => {
    const m = mocks({ fetchError: 'Could not fetch https://example.com/down.md: TypeError' });
    const app = await makeApp(m);
    const pr = await setupPr({
      body: 'Ticket https://acme.atlassian.net/browse/ABC-1 and https://example.com/down.md',
    });
    const res = await derive(app, pr.id);
    const intent = (res.json() as PrIntentResponse).intent!;
    expect(intent.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: 'https://acme.atlassian.net/browse/ABC-1', status: 'unsupported' }),
        expect.objectContaining({ ref: 'https://example.com/down.md', status: 'unavailable' }),
      ]),
    );
    const missing = intent.missing_context.join('\n');
    expect(missing).toContain('https://acme.atlassian.net/browse/ABC-1');
    expect(missing).toContain('https://example.com/down.md');
    expect(intent.confidence).not.toBe('high');
    // The auth-required host is never requested.
    expect(m.web.calls).toEqual(['https://example.com/down.md']);
    expect(JSON.stringify(lastReq(m.llm).messages)).not.toContain('EXTERNAL_DOC_TEXT');
    await app.close();
  });

  it('5b. INTENT_EXTERNAL_FETCH=false: external https is unsupported and NO request is made', async () => {
    const m = mocks();
    const app = await makeApp(m, { INTENT_EXTERNAL_FETCH: 'false' });
    const pr = await setupPr({ body: 'See https://example.com/spec.md' });
    const intent = ((await derive(app, pr.id)).json() as PrIntentResponse).intent!;
    expect(m.web.calls).toEqual([]);
    expect(intent.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'external_doc',
          ref: 'https://example.com/spec.md',
          status: 'unsupported',
          reason: 'external fetch disabled',
        }),
      ]),
    );
    expect(intent.missing_context.join('\n')).toContain('https://example.com/spec.md');
    expect(intent.confidence).not.toBe('high');
    await app.close();
  });

  it('6. R8: empty description caps confidence at low and records the gap', async () => {
    const m = mocks();
    const app = await makeApp(m);
    const pr = await setupPr({ body: '' });
    const intent = ((await derive(app, pr.id)).json() as PrIntentResponse).intent!;
    expect(intent.confidence).toBe('low');
    expect(intent.sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'pr_body', status: 'unavailable' })]),
    );
    expect(intent.missing_context.join('\n')).toMatch(/description is empty/i);
    await app.close();
  });

  it('7. R2: stale after the head sha changes; re-derive refreshes; exactly one row', async () => {
    const app = await makeApp(mocks());
    const pr = await setupPr();
    const first = ((await derive(app, pr.id)).json() as PrIntentResponse).intent!;
    expect(first.stale).toBe(false);
    expect(first.head_sha).toBe('aaaaaaa1111');

    await pg.handle.db.update(t.pullRequests).set({ headSha: 'bbbbbbb2222' }).where(eq(t.pullRequests.id, pr.id));
    const stale = ((await get(app, pr.id)).json() as PrIntentResponse).intent!;
    expect(stale.stale).toBe(true);

    const fresh = ((await derive(app, pr.id)).json() as PrIntentResponse).intent!;
    expect(fresh.stale).toBe(false);
    expect(fresh.head_sha).toBe('bbbbbbb2222');
    const rows = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
    expect(rows).toHaveLength(1);
    await app.close();
  });

  it('8. failure: provider error is redacted and persisted as failed (200)', async () => {
    const m = mocks();
    vi.spyOn(m.llm, 'completeStructured').mockRejectedValue(new Error('401 Bearer sk-or-v1-deadbeef'));
    const app = await makeApp(m);
    const pr = await setupPr();
    const res = await derive(app, pr.id);
    expect(res.statusCode).toBe(200);
    const intent = (res.json() as PrIntentResponse).intent!;
    expect(intent.status).toBe('failed');
    expect(intent.error).toContain('[REDACTED]');
    expect(intent.error).not.toContain('sk-or-v1-deadbeef');
    await app.close();
  });

  it('8b. failure: no openrouter key -> failed with a clear error', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient(), webFetcher: new MockWebFetcher(), secrets: new MockSecretsProvider({}) },
    });
    const pr = await setupPr();
    const res = await derive(app, pr.id);
    const intent = (res.json() as PrIntentResponse).intent!;
    expect(res.statusCode).toBe(200);
    expect(intent.status).toBe('failed');
    expect(intent.error).toContain('OPENROUTER_API_KEY');
    await app.close();
  });

  it('9/10. V6: logs and the persisted composition carry stats only', async () => {
    const m = mocks({ files: { 'docs/plans/foo.md': `${PLAN_MARKER}` } });
    const app = await makeApp(m);
    const pr = await setupPr({
      body: `${BODY_SENTINEL} plan docs/plans/foo.md and https://example.com/x.md?token=abc123`,
    });
    const lines: { msg: string; data?: unknown }[] = [];
    const log: IntentLog = {
      info: (msg, data) => lines.push({ msg, data }),
      tool: (msg, data) => lines.push({ msg, data }),
      error: (msg, data) => lines.push({ msg, data }),
    };
    await new IntentService(app.container).derive(workspaceId, pr.id, { log });

    const request = lines.find((l) => l.msg.startsWith('intent: classifier request — provider=openrouter model=deepseek/deepseek-v4-flash sections=['));
    expect(request).toBeDefined();
    expect(lines.some((l) => l.msg.startsWith('intent: classifier response — tokens=100/50'))).toBe(true);

    const everything = JSON.stringify(lines);
    for (const s of [BODY_SENTINEL, PLAN_MARKER, DIFF_SENTINEL, '?token=', 'abc123']) {
      expect(everything).not.toContain(s);
    }

    const [row] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
    for (const c of row!.composition) {
      expect(Object.keys(c).sort()).toEqual(['chars', 'est_tokens', 'name', 'sha256']);
    }
    const persisted = JSON.stringify(row!.composition) + JSON.stringify(row!.sources);
    for (const s of [BODY_SENTINEL, PLAN_MARKER, DIFF_SENTINEL, '?token=', 'abc123']) {
      expect(persisted).not.toContain(s);
    }
    await app.close();
  });

  it('review path: ensureForReview derives when missing, reuses when fresh, re-derives when stale, returns null on failure', async () => {
    const m = mocks();
    const app = await makeApp(m);
    const pr = await setupPr();
    const svc = new IntentService(app.container);
    const lines: string[] = [];
    const log: IntentLog = {
      info: (msg) => lines.push(msg),
      tool: (msg) => lines.push(msg),
      error: (msg) => lines.push(msg),
    };
    const pull = { id: pr.id, number: pr.number, title: pr.title, body: pr.body, headSha: 'aaaaaaa1111' };
    const repo = { owner: 'acme', name: 'x' };
    const diff = { raw: '', files: [] };

    const first = await svc.ensureForReview(workspaceId, pull, repo, diff, log);
    expect(first?.filterEnabled).toBe(true);
    expect(first?.block).toContain('Summary: Adds rate limiting');
    expect(structuredCalls(m.llm)).toHaveLength(1);

    await svc.ensureForReview(workspaceId, pull, repo, diff, log);
    expect(structuredCalls(m.llm)).toHaveLength(1);
    expect(lines).toContain('intent: using cached intent (derived for aaaaaaa)');

    const moved = { ...pull, headSha: 'ccccccc3333' };
    await svc.ensureForReview(workspaceId, moved, repo, diff, log);
    expect(structuredCalls(m.llm)).toHaveLength(2);
    expect(lines).toContain('intent: stale (derived for aaaaaaa, head ccccccc) — re-deriving');

    vi.spyOn(m.llm, 'completeStructured').mockRejectedValue(new Error('boom'));
    const failed = await svc.ensureForReview(workspaceId, { ...pull, headSha: 'ddddddd4444' }, repo, diff, log);
    expect(failed).toBeNull();
    await app.close();
  });
});
