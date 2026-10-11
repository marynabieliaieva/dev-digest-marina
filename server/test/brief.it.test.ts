import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { eq } from 'drizzle-orm';
import type { LLMProvider, StructuredRequest, StructuredResult, PrBriefResponse } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import { BriefService } from '../src/modules/brief/service.js';
import briefRoutes from '../src/modules/brief/routes.js';
import type { BriefLog } from '../src/modules/brief/helpers.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = (env: Record<string, string> = {}) =>
  loadConfig({ ...process.env, NODE_ENV: 'test', REPO_INTEL_ENABLED: 'false', ...env } as NodeJS.ProcessEnv);

const MARKER = 'MARKER_7f3a';
const BODY_SENTINEL = 'BODY_SENTINEL_55e1';
const HEADER = '@@ -10,3 +10,4 @@ function boot()';
const PATCH = `${HEADER}\n   port: 3000,\n+const ${MARKER} = 1;\n   redisUrl: x,`;

const GOOD = {
  summary: 'Adds rate limiting.',
  risks: [
    { kind: 'perf', title: 'Throughput', explanation: 'x', severity: 'high', file_refs: ['src/config.ts'] },
  ],
  review_focus: [
    { file: 'src/config.ts', line: 11, reason: 'limiter config' },
    { file: 'src/config.ts', line: 9999, reason: 'bogus' },
  ],
};

/** Test-local LLM: can be held open, rejected, and reports a fixed `attempts`. */
class StubLLM implements LLMProvider {
  readonly id = 'openai' as const;
  calls: StructuredRequest<unknown>[] = [];
  release: (() => void) | null = null;
  constructor(
    private opts: { hold?: boolean; error?: Error; output?: unknown; attempts?: number } = {},
  ) {}
  async listModels() {
    return [];
  }
  async complete(): Promise<never> {
    throw new Error('not used');
  }
  async embed(): Promise<number[][]> {
    return [];
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push(req as StructuredRequest<unknown>);
    if (this.opts.hold) await new Promise<void>((r) => (this.release = r));
    if (this.opts.error) throw this.opts.error;
    const data = (req.schema as { parse(v: unknown): T }).parse(this.opts.output ?? GOOD);
    return {
      data,
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.002,
      raw: '',
      attempts: this.opts.attempts ?? 3,
    };
  }
}

d('brief module (Testcontainers pg)', () => {
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

  async function makeApp(
    opts: { llm?: LLMProvider | null; github?: boolean; env?: Record<string, string>; repoIntel?: unknown } = {},
  ) {
    return buildApp({
      config: config(opts.env),
      db: pg.handle.db,
      overrides: {
        ...(opts.llm === null ? {} : { llm: { openai: opts.llm ?? new StubLLM() } }),
        ...(opts.github === false ? {} : { github: new MockGitHubClient({ pulls: [] }) }),
        ...(opts.repoIntel ? { repoIntel: opts.repoIntel as never } : {}),
        secrets: new MockSecretsProvider({}),
      },
    });
  }
  type App = Awaited<ReturnType<typeof makeApp>>;

  async function setupPr(over: { body?: string | null; headSha?: string; clonePath?: string | null; ws?: string } = {}) {
    const name = `brief-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: over.ws ?? workspaceId,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        clonePath: over.clonePath ?? null,
      })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: over.ws ?? workspaceId,
        repoId: repo!.id,
        number: 1000 + seq,
        title: 'Add rate limiting',
        author: 'dev',
        branch: 'feat/rl',
        base: 'main',
        headSha: over.headSha ?? 'abc1111',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: over.body === undefined ? `Fixes #12. ${BODY_SENTINEL}` : over.body,
      })
      .returning();
    await pg.handle.db
      .insert(t.prFiles)
      .values({ prId: pr!.id, path: 'src/config.ts', additions: 1, deletions: 0, patch: PATCH });
    return pr!;
  }

  const get = (app: App, id: string) => app.inject({ method: 'GET', url: `/pulls/${id}/brief` });
  const post = (app: App, id: string, payload?: unknown) =>
    app.inject({
      method: 'POST',
      url: `/pulls/${id}/brief`,
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  it('AC-4/5/8: GET is DB-only; POST {} and POST with no payload generate; stale after head moves', async () => {
    const llm = new StubLLM();
    const gh = new MockGitHubClient({ pulls: [] });
    const getIssue = vi.spyOn(gh, 'getIssue');
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: llm }, github: gh, secrets: new MockSecretsProvider({}) },
    });
    const pr = await setupPr();

    const empty = (await get(app, pr.id)).json() as PrBriefResponse;
    expect(empty).toMatchObject({ brief: null, stale: false, generating: false, current_head_sha: 'abc1111' });
    expect(llm.calls).toHaveLength(0);

    const res = await post(app, pr.id, {});
    expect(res.statusCode).toBe(200);
    const first = res.json() as PrBriefResponse;
    expect(first.brief!.head_sha).toBe('abc1111');
    expect(first.stale).toBe(false);
    expect(first.brief!.summary).toBe('Adds rate limiting.');
    expect(first.brief!.history).toEqual({ history: [] });
    // Focus line 9999 is outside every changed range and is dropped.
    expect(first.brief!.review_focus.map((f) => f.line)).toEqual([11]);
    expect(first.brief!.dropped.review_focus).toBe(1);
    expect(first.brief!.attempts).toBe(3);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.schemaName).toBe('PrBriefGeneration');
    expect(getIssue).toHaveBeenCalledTimes(1);

    const llmCallsBefore = llm.calls.length;
    const stored = (await get(app, pr.id)).json() as PrBriefResponse;
    expect(stored.brief!.generated_at).toBe(first.brief!.generated_at);
    expect(llm.calls).toHaveLength(llmCallsBefore);
    expect(getIssue).toHaveBeenCalledTimes(1);

    const noPayload = await post(app, pr.id);
    expect(noPayload.statusCode).toBe(200);
    expect(llm.calls).toHaveLength(2);

    await pg.handle.db.update(t.pullRequests).set({ headSha: 'def2222' }).where(eq(t.pullRequests.id, pr.id));
    const stale = (await get(app, pr.id)).json() as PrBriefResponse;
    expect(stale.stale).toBe(true);
    expect(stale.brief!.head_sha).toBe('abc1111');
    await app.close();
  });

  it('AC-7: other workspace gives 404, non-uuid gives 422', async () => {
    const app = await makeApp();
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: `other-${seq++}` }).returning();
    const pr = await setupPr({ ws: other!.id });
    expect((await get(app, pr.id)).statusCode).toBe(404);
    expect((await post(app, pr.id)).statusCode).toBe(404);
    expect((await get(app, 'nope')).statusCode).toBe(422);
    expect((await post(app, 'nope')).statusCode).toBe(422);
    await app.close();
  });

  it('AC-6/11: held generation shows generating and a second POST gets 409', async () => {
    const llm = new StubLLM({ hold: true });
    const app = await makeApp({ llm });
    const pr = await setupPr();
    const first = post(app, pr.id);
    await vi.waitFor(() => expect(llm.calls).toHaveLength(1));

    expect(((await get(app, pr.id)).json() as PrBriefResponse).generating).toBe(true);
    const second = await post(app, pr.id);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('brief_in_progress');

    llm.release!();
    expect((await first).statusCode).toBe(200);
    expect(llm.calls).toHaveLength(1);
    expect(((await get(app, pr.id)).json() as PrBriefResponse).generating).toBe(false);
    await app.close();
  });

  it('AC-9/10: if_stale skips a fresh brief and regenerates a stale or missing one', async () => {
    const llm = new StubLLM();
    const app = await makeApp({ llm });
    const pr = await setupPr();
    const missing = (await post(app, pr.id, { mode: 'if_stale' })).json() as PrBriefResponse;
    expect(llm.calls).toHaveLength(1);

    const fresh = (await post(app, pr.id, { mode: 'if_stale' })).json() as PrBriefResponse;
    expect(llm.calls).toHaveLength(1);
    expect(fresh.brief!.generated_at).toBe(missing.brief!.generated_at);

    await pg.handle.db.update(t.pullRequests).set({ headSha: 'new3333' }).where(eq(t.pullRequests.id, pr.id));
    const regenerated = (await post(app, pr.id, { mode: 'if_stale' })).json() as PrBriefResponse;
    expect(llm.calls).toHaveLength(2);
    expect(regenerated.brief!.head_sha).toBe('new3333');
    expect(regenerated.stale).toBe(false);
    await app.close();
  });

  it('AC-12: the 11th POST in a minute is 429 (non-test nodeEnv) and the route carries the limit', async () => {
    const app = await makeApp({ env: { NODE_ENV: 'development' } });
    const pr = await setupPr();
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await post(app, pr.id)).statusCode;
    expect(last).toBe(429);
    await app.close();

    const captured: Array<{ method: unknown; url: string; config?: { rateLimit?: unknown } }> = [];
    const bare = Fastify();
    bare.setValidatorCompiler(validatorCompiler);
    bare.setSerializerCompiler(serializerCompiler);
    bare.decorate('container', { db: pg.handle.db });
    bare.addHook('onRoute', (r) => captured.push(r as never));
    await bare.register(briefRoutes);
    const route = captured.find((r) => r.url === '/pulls/:id/brief' && r.method === 'POST');
    expect(route?.config?.rateLimit).toEqual({ max: 10, timeWindow: '1 minute' });
    await bare.close();
  });

  it('AC-14: the configured risk_brief model is used and stored', async () => {
    const llm = new StubLLM();
    const app = await makeApp({ llm });
    const pr = await setupPr();
    const put = (model: string) =>
      app.inject({
        method: 'PUT',
        url: '/settings',
        payload: { feature_models: { risk_brief: { provider: 'openai', model } } },
      });
    expect((await put('x-test')).statusCode).toBe(200);
    const res = (await post(app, pr.id)).json() as PrBriefResponse;
    expect(llm.calls[0]!.model).toBe('x-test');
    expect(res.brief).toMatchObject({ provider: 'openai', model: 'x-test' });
    await put('gpt-4.1');
    await app.close();
  });

  it('AC-15: provider failure gives 502 provider_error, scrubbed, and keeps the stored brief', async () => {
    const pr = await setupPr();
    const ok = await makeApp();
    const a = (await post(ok, pr.id)).json() as PrBriefResponse;
    await ok.close();

    const bad = await makeApp({ llm: new StubLLM({ error: new Error('401 Bearer sk-test-123') }) });
    const res = await post(bad, pr.id);
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('brief_generation_failed');
    expect(res.body).not.toContain('sk-');
    expect(res.json().error.details.reason).toBe('provider_error');
    const after = (await get(bad, pr.id)).json() as PrBriefResponse;
    expect(after.brief!.generated_at).toBe(a.brief!.generated_at);
    await bad.close();
  });

  it('AC-15: schema failure gives schema_invalid; missing LLM key gives missing_key', async () => {
    const pr = await setupPr();
    const app = await makeApp({ llm: new StubLLM({ error: new Error('X structured output failed schema validation') }) });
    expect((await post(app, pr.id)).json().error.details.reason).toBe('schema_invalid');
    await app.close();

    const noKey = await makeApp({ llm: null });
    const res = await post(noKey, pr.id);
    expect(res.statusCode).toBe(502);
    expect(res.json().error.details.reason).toBe('missing_key');
    await noKey.close();
  });

  it('AC-15/20: no GitHub token still gives 200 with a linked_issue gap (not missing_key)', async () => {
    const app = await makeApp({ github: false });
    const pr = await setupPr();
    const res = await post(app, pr.id);
    expect(res.statusCode).toBe(200);
    expect((res.json() as PrBriefResponse).brief!.data_gaps).toContainEqual(
      expect.objectContaining({ source: 'linked_issue', status: 'missing' }),
    );
    await app.close();
  });

  it('AC-17: no body lines reach the model, only hunk ranges', async () => {
    const llm = new StubLLM();
    const app = await makeApp({ llm });
    const pr = await setupPr();
    await post(app, pr.id);
    const text = llm.calls[0]!.messages.map((m) => String(m.content)).join('\n');
    expect(text).not.toContain(MARKER);
    expect(text).toContain('10-13');
    await app.close();
  });

  it('AC-19: attached specs from enabled agents and skills are sent in order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'brief-specs-'));
    for (const [rel, c] of Object.entries({ 'specs/a.md': 'A', 'specs/b.md': 'B', 'specs/c.md': 'C' })) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), c);
    }
    const db = pg.handle.db;
    const [a] = await db
      .insert(t.agents)
      .values({ workspaceId, name: `A${seq}`, provider: 'openai', model: 'gpt-4.1', systemPrompt: 's', enabled: true })
      .returning();
    await db.insert(t.agentContextDocs).values({ agentId: a!.id, path: 'specs/a.md', order: 0 });
    const [b] = await db
      .insert(t.agents)
      .values({ workspaceId, name: `B${seq}`, provider: 'openai', model: 'gpt-4.1', systemPrompt: 's', enabled: false })
      .returning();
    await db.insert(t.agentContextDocs).values({ agentId: b!.id, path: 'specs/b.md', order: 0 });
    const [s] = await db
      .insert(t.skills)
      .values({ workspaceId, name: `S${seq}`, description: 'd', type: 'custom', source: 'manual', body: 'b' })
      .returning();
    await db.insert(t.skillContextDocs).values([
      { skillId: s!.id, path: 'specs/a.md', order: 0 },
      { skillId: s!.id, path: 'specs/c.md', order: 1 },
    ]);
    await db.insert(t.agentSkills).values({ agentId: a!.id, skillId: s!.id, order: 0 });

    const app = await makeApp();
    const pr = await setupPr({ clonePath: dir });
    const res = (await post(app, pr.id)).json() as PrBriefResponse;
    const refs = res.brief!.inputs.filter((i) => i.name === 'specs' && i.ref).map((i) => i.ref);
    expect(refs).toEqual(['specs/a.md', 'specs/c.md']);
    await app.close();
    // Detach so later tests are unaffected.
    await db.update(t.agents).set({ enabled: false }).where(eq(t.agents.id, a!.id));
  });

  it('AC-20: no intent and flag off give intent missing and blast degraded gaps', async () => {
    const app = await makeApp();
    const pr = await setupPr({ body: '' });
    const gaps = ((await post(app, pr.id)).json() as PrBriefResponse).brief!.data_gaps;
    expect(gaps).toContainEqual(expect.objectContaining({ source: 'intent', status: 'missing' }));
    expect(gaps).toContainEqual(expect.objectContaining({ source: 'blast_radius', status: 'degraded' }));
    expect(gaps).toContainEqual(expect.objectContaining({ source: 'pr_description', status: 'missing' }));
    expect(gaps).toContainEqual(expect.objectContaining({ source: 'specs', status: 'missing' }));
    await app.close();
  });

  it('AC-21: a throwing blast service still yields a brief with a blast_radius/missing gap', async () => {
    const boom = new Proxy({}, { get: () => async () => { throw new Error('index exploded'); } });
    const app = await makeApp({ repoIntel: boom });
    const pr = await setupPr();
    const res = await post(app, pr.id);
    expect(res.statusCode).toBe(200);
    const brief = (res.json() as PrBriefResponse).brief!;
    expect(brief.summary.length).toBeGreaterThan(0);
    expect(brief.data_gaps).toContainEqual(expect.objectContaining({ source: 'blast_radius', status: 'missing' }));
    expect(brief.blast).toBeNull();
    await app.close();
  });

  it('AC-22: a ready intent row is embedded in the brief', async () => {
    const app = await makeApp();
    const pr = await setupPr();
    await pg.handle.db.insert(t.prIntent).values({
      prId: pr.id,
      intent: 'Stored intent summary',
      confidence: 'high',
      status: 'ready',
      headSha: 'abc1111',
    });
    const brief = ((await post(app, pr.id)).json() as PrBriefResponse).brief!;
    expect(brief.intent!.summary).toBe('Stored intent summary');
    await app.close();
  });

  it('AC-45: one tool log before and one after the call, with no PR text', async () => {
    const app = await makeApp();
    const pr = await setupPr();
    const entries: Array<{ msg: string; data: Record<string, unknown> }> = [];
    const log: BriefLog = {
      tool: (msg, data) => entries.push({ msg, data: data as Record<string, unknown> }),
      error: (msg, data) => entries.push({ msg, data: data as Record<string, unknown> }),
    };
    await new BriefService(app.container).generate(workspaceId, pr.id, 'refresh', log);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.data).toMatchObject({ call: 'pr_brief', budget: 8000 });
    expect(entries[0]!.data).toHaveProperty('sections');
    expect(entries[0]!.data).toHaveProperty('est_tokens');
    expect(entries[1]!.data).toMatchObject({ call: 'pr_brief', tokens_in: 100, tokens_out: 50, cost_usd: 0.002, attempts: 3 });
    expect(entries[1]!.data).toHaveProperty('duration_ms');
    expect(entries[1]!.data).toHaveProperty('dropped');
    expect(JSON.stringify(entries)).not.toContain(BODY_SENTINEL);
    await app.close();
  });
});
