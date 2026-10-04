import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockLLMProvider,
  MockEmbedder,
  MockGitClient,
  MockGitHubClient,
  MockWebFetcher,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review, StructuredRequest, StructuredResult } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[intent-review-pipeline] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF_SENTINEL = 'SENTINEL_DIFF_BODY_7f3a';
const BODY_SENTINEL = 'BODY_SENTINEL_55e1';
const PLAN_MARKER = 'PLAN_MARKER_91c2';
const SUMMARY = 'Adds a Stripe key to the config.';

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@ function boot()
   port: 3000,
+  const ${DIFF_SENTINEL} = 1;
   redisUrl: x,`;

const CLASSIFICATION = {
  summary: SUMMARY,
  in_scope: ['config changes'],
  out_of_scope: ['billing refactors'],
  risk_areas: ['secrets'],
  confidence: 'high',
  missing_context: [],
};

const finding = (over: Record<string, unknown>) => ({
  id: 'f',
  severity: 'WARNING',
  category: 'bug',
  title: 't',
  file: 'src/config.ts',
  start_line: 11,
  end_line: 11,
  rationale: 'why',
  confidence: 0.9,
  kind: 'finding',
  ...over,
});

const REVIEW_FIXTURE = {
  verdict: 'comment',
  summary: 'Mixed.',
  score: 50,
  findings: [
    finding({ id: 'a', title: 'In scope warning', severity: 'WARNING', scope: 'in_scope' }),
    finding({ id: 'b', title: 'In scope nit', severity: 'SUGGESTION', scope: 'in_scope' }),
    finding({ id: 'c', title: 'Billing is broken', severity: 'CRITICAL', scope: 'out_of_scope' }),
    finding({ id: 'e', title: 'Billing naming', severity: 'SUGGESTION', scope: 'out_of_scope' }),
  ],
} as unknown as Review;

/** Records call order across both providers; optionally throws. */
class RecordingLLM extends MockLLMProvider {
  constructor(
    id: 'openai' | 'anthropic',
    fixtures: ConstructorParameters<typeof MockLLMProvider>[1],
    private order: string[],
    private label: string,
    private failWith?: string,
  ) {
    super(id, fixtures);
  }
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.order.push(this.label);
    if (this.failWith) {
      this.calls.push({ method: 'completeStructured', req });
      throw new Error(this.failWith);
    }
    return super.completeStructured(req);
  }
}

d('intent wired into the review run (Testcontainers pg)', () => {
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

  function setup(opts: { intentFails?: string; noIntentProvider?: boolean } = {}) {
    const order: string[] = [];
    const A = new RecordingLLM(
      'openai',
      { structuredBySchema: { IntentClassification: CLASSIFICATION } },
      order,
      'A',
      opts.intentFails,
    );
    const B = new RecordingLLM('openai', { structured: REVIEW_FIXTURE }, order, 'B');
    return { A, B, order, noIntentProvider: opts.noIntentProvider ?? false };
  }

  function makeApp(m: ReturnType<typeof setup>) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient({ files: { 'docs/plans/foo.md': `# Plan\n${PLAN_MARKER}` } }),
        webFetcher: new MockWebFetcher({ text: 'EXTERNAL' }),
        secrets: new MockSecretsProvider({}),
        llm: { openai: m.B, ...(m.noIntentProvider ? {} : { openrouter: m.A }) },
      },
    });
  }
  type App = Awaited<ReturnType<typeof makeApp>>;

  async function setupPr() {
    const name = `intent-pipe-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 700 + seq,
        title: 'Add config',
        author: 'dev',
        branch: 'feat/cfg',
        base: 'main',
        headSha: 'cafebabe1234',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: `Config change. Plan: docs/plans/foo.md ${BODY_SENTINEL}`,
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: `@@ -10,3 +10,4 @@ function boot()\n   port: 3000,\n+  const ${DIFF_SENTINEL} = 1;\n   redisUrl: x,`,
    });
    return pr!;
  }

  async function makeAgent(app: App) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: `Pipe Agent ${Math.random().toString(36).slice(2, 8)}`,
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'Review the diff.',
        repo_intel: false,
      },
    });
    return res.json().id as string;
  }

  async function runAndCollect(app: App, prId: string, agentId: string) {
    const before = (await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, prId))).length;
    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/review`, payload: { agentId } });
    const runId = res.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, prId, { expected: before + 1 });
    const deadline = Date.now() + 5_000;
    let trace: any;
    for (;;) {
      const r = await app.inject({ method: 'GET', url: `/runs/${runId}/trace` });
      if (r.statusCode === 200) {
        trace = r.json();
        break;
      }
      if (Date.now() > deadline) throw new Error(`trace for run ${runId} never appeared`);
      await new Promise((x) => setTimeout(x, 25));
    }
    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    const [review] = await pg.handle.db.select().from(t.reviews).where(eq(t.reviews.runId, runId));
    const rows = review
      ? await pg.handle.db.select().from(t.findings).where(eq(t.findings.reviewId, review.id))
      : [];
    const log = (trace.log as { msg: string }[]).map((l) => l.msg);
    return { runId, run: run!, review, rows, trace, log };
  }

  const structured = (llm: MockLLMProvider) =>
    llm.calls.filter((c) => c.method === 'completeStructured').map((c) => c.req as any);
  const userMsg = (req: any) =>
    (req.messages as { role: string; content: string }[]).filter((m) => m.role === 'user').map((m) => m.content).join('\n');

  // Expected score for kept = WARNING(12) + SUGGESTION(3) + CRITICAL(35).
  const EXPECTED_SCORE = 100 - 12 - 3 - 35;

  it('1-4. two separate calls, injection, scope filter, ordered trace log', async () => {
    const m = setup();
    const app = await makeApp(m);
    const pr = await setupPr();
    const out = await runAndCollect(app, pr.id, await makeAgent(app));

    // 1. two separate calls, A before B
    const a = structured(m.A);
    const b = structured(m.B);
    expect(a).toHaveLength(1);
    expect(a[0].schemaName).toBe('IntentClassification');
    expect(a[0].model).toBe('deepseek/deepseek-v4-flash');
    expect(a[0].requireParameters).toBe(true);
    expect(b).toHaveLength(1);
    expect(b[0].schemaName).toBe('Review');
    expect(b[0].model).toBe('gpt-4.1');
    expect(m.order).toEqual(['A', 'B']);

    // 2. injection
    const user = userMsg(b[0]);
    expect(user).toContain('## Derived intent');
    expect(user).toContain('<untrusted source="derived-intent">');
    expect(user).toContain(SUMMARY);
    expect(out.trace.prompt_assembly.intent).toBeTruthy();

    // 3. filter
    expect(out.run.status).toBe('done');
    expect(out.rows).toHaveLength(3);
    const titles = out.rows.map((r) => r.title);
    expect(titles).toContain('In scope warning');
    expect(titles).toContain('In scope nit');
    expect(titles.filter((x) => x.startsWith('[Out of scope] '))).toHaveLength(1);
    expect(titles.some((x) => x.includes('Billing naming'))).toBe(false);
    expect(out.review!.score).toBe(EXPECTED_SCORE);

    // 4. trace log order + no leaks
    const idx = (re: RegExp) => out.log.findIndex((l) => re.test(l));
    const iReq = idx(/^intent: classifier request — provider=openrouter model=deepseek\/deepseek-v4-flash sections=\[/);
    const iRes = idx(/^intent: classifier response — /);
    const iMain = idx(/^review: main request — provider=openai model=gpt-4\.1 sections=\[.*intent:/);
    const iScope = out.log.indexOf('Scope filter: kept 3, suppressed 1, signal 1');
    expect(iReq).toBeGreaterThanOrEqual(0);
    expect(iRes).toBeGreaterThan(iReq);
    expect(iMain).toBeGreaterThan(iRes);
    expect(iScope).toBeGreaterThan(iMain);
    for (const line of out.log) {
      expect(line).not.toContain(DIFF_SENTINEL);
      expect(line).not.toContain(BODY_SENTINEL);
      expect(line).not.toContain(PLAN_MARKER);
    }
    await app.close();
  });

  async function deriveThenGoStale() {
    const m1 = setup();
    const app1 = await makeApp(m1);
    const pr = await setupPr();
    const agentId = await makeAgent(app1);
    await runAndCollect(app1, pr.id, agentId);
    await pg.handle.db.update(t.prIntent).set({ headSha: 'oldsha000000' }).where(eq(t.prIntent.prId, pr.id));
    await app1.close();
    return { pr, agentId };
  }

  it('5. stale intent is auto re-derived before the agents run', async () => {
    const { pr, agentId } = await deriveThenGoStale();
    const m = setup();
    const app = await makeApp(m);
    const out = await runAndCollect(app, pr.id, agentId);

    expect(structured(m.A)).toHaveLength(1);
    const iStale = out.log.findIndex((l) => l === 'intent: stale (derived for oldsha0, head cafebab) — re-deriving');
    const iReq = out.log.findIndex((l) => l.startsWith('intent: classifier request'));
    expect(iStale).toBeGreaterThanOrEqual(0);
    expect(iReq).toBeGreaterThan(iStale);
    const [row] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
    expect(row!.headSha).toBe('cafebabe1234');
    expect(out.rows).toHaveLength(3);
    expect(out.log).toContain('Scope filter: kept 3, suppressed 1, signal 1');
    await app.close();
  });

  it('5b. stale + re-derive fails: run still done, no intent block, no suppression', async () => {
    const { pr, agentId } = await deriveThenGoStale();
    const m = setup({ intentFails: 'classifier down' });
    const app = await makeApp(m);
    const out = await runAndCollect(app, pr.id, agentId);

    expect(out.run.status).toBe('done');
    expect(userMsg(structured(m.B)[0])).not.toContain('## Derived intent');
    expect(out.rows).toHaveLength(4);
    // the previous good intent is kept untouched (not overwritten by a failed row)
    const [row] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
    expect(row!.status).toBe('ready');
    expect(row!.headSha).toBe('oldsha000000');
    expect(row!.intent).toBe(SUMMARY);
    await app.close();
  });

  it('5c. a failed intent is retried automatically on the next review', async () => {
    const m1 = setup({ intentFails: 'classifier down' });
    const app1 = await makeApp(m1);
    const pr = await setupPr();
    const agentId = await makeAgent(app1);
    await runAndCollect(app1, pr.id, agentId);
    const [failedRow] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
    expect(failedRow!.status).toBe('failed');
    await app1.close();

    const m = setup();
    const app = await makeApp(m);
    const out = await runAndCollect(app, pr.id, agentId);
    expect(structured(m.A)).toHaveLength(1);
    const iRetry = out.log.indexOf('intent: previous derivation failed — retrying');
    const iReq = out.log.findIndex((l) => l.startsWith('intent: classifier request'));
    expect(iRetry).toBeGreaterThanOrEqual(0);
    expect(iReq).toBeGreaterThan(iRetry);
    const [row] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
    expect(row!.status).toBe('ready');
    expect(userMsg(structured(m.B)[0])).toContain('## Derived intent');
    await app.close();
  });

  it('6. degrade: no openrouter key/override → intent failed, review unaffected', async () => {
    const m = setup({ noIntentProvider: true });
    const app = await makeApp(m);
    const pr = await setupPr();
    const out = await runAndCollect(app, pr.id, await makeAgent(app));

    expect(out.run.status).toBe('done');
    expect(out.log.some((l) => l.startsWith('intent: classifier failed — '))).toBe(true);
    expect(userMsg(structured(m.B)[0])).not.toContain('## Derived intent');
    expect(out.rows).toHaveLength(4);
    await app.close();
  });
});
