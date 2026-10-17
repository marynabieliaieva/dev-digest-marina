import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import { evalQueue } from '../src/modules/eval/queue.js';
import * as t from '../src/db/schema.js';
import type { Review, StructuredRequest, StructuredResult } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Two files; the findings under test live on `src/config.ts` line 11. */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,
diff --git a/src/other.ts b/src/other.ts
--- a/src/other.ts
+++ b/src/other.ts
@@ -1,2 +1,3 @@
 const a = 1;
+const b = 2;
 export {};`;

const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

/** A mock provider whose structured calls can be held back (slow LLM). */
class GatedLLM extends MockLLMProvider {
  arrived = 0;
  private closed = false;
  private waiters: Array<() => void> = [];

  close() {
    this.closed = true;
  }
  open() {
    this.closed = false;
    for (const w of this.waiters.splice(0)) w();
  }
  releaseOne() {
    this.waiters.shift()?.();
  }
  reset() {
    this.calls = [];
    this.arrived = 0;
    this.open();
  }

  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.arrived++;
    if (this.closed) await new Promise<void>((resolve) => this.waiters.push(resolve));
    return super.completeStructured(req);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

d('eval pipeline (integration)', () => {
  let pg: PgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let workspaceId: string;
  let db: PgFixture['handle']['db'];
  const llm = new GatedLLM('openai', { structured: REVIEW_FIXTURE });
  const gitOpts = { diff: DIFF };
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;
    await seed(db);
    const [ws] = await db.select().from(t.workspaces);
    workspaceId = ws!.id;
    app = await buildApp({
      config: config(),
      db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient(gitOpts),
        llm: { openai: llm },
      },
    });
  });

  afterEach(async () => {
    llm.reset();
    gitOpts.diff = DIFF;
    // The queue is process-wide: let everything drain so tests stay independent.
    await evalQueue.idle();
  });

  afterAll(async () => {
    llm.open();
    await app?.close();
    await pg?.stop();
  });

  // ---- seeding helpers --------------------------------------------------------

  async function seedAgent(over: Partial<typeof t.agents.$inferInsert> = {}, ws = workspaceId) {
    const [agent] = await db
      .insert(t.agents)
      .values({
        workspaceId: ws,
        name: `Eval Agent ${seq++}-${Math.random().toString(36).slice(2, 6)}`,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'Review the diff.',
        ...over,
      })
      .returning();
    return agent!;
  }

  /** repo + PR (+ pr_files) + one review by `agentId`. */
  async function seedReview(agentId: string | null, ws = workspaceId) {
    const name = `eval-repo-${seq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 700 + seq,
        title: 'Add a stripe key',
        author: 'dev',
        branch: 'feat/x',
        base: 'main',
        headSha: 'deadbeef',
        additions: 2,
        deletions: 0,
        filesCount: 2,
        status: 'needs_review',
        body: 'Adds config.',
      })
      .returning();
    await db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    const [review] = await db
      .insert(t.reviews)
      .values({ workspaceId: ws, prId: pr!.id, agentId, kind: 'review', verdict: 'comment', summary: 's', score: 80 })
      .returning();
    return { repo: repo!, pr: pr!, review: review! };
  }

  async function seedFinding(
    reviewId: string,
    over: Partial<typeof t.findings.$inferInsert> & { decided?: 'accepted' | 'dismissed' | null } = {},
  ) {
    const { decided = 'accepted', ...rest } = over;
    const [f] = await db
      .insert(t.findings)
      .values({
        reviewId,
        file: 'src/config.ts',
        startLine: 11,
        endLine: 11,
        severity: 'CRITICAL',
        category: 'security',
        title: `Finding ${seq++}`,
        rationale: 'because',
        confidence: 0.9,
        kind: 'finding',
        acceptedAt: decided === 'accepted' ? new Date() : null,
        dismissedAt: decided === 'dismissed' ? new Date() : null,
        ...rest,
      })
      .returning();
    return f!;
  }

  /** An agent with `n` accepted findings, each turned into an eval case through the API. */
  async function agentWithCases(n: number, agentOver: Partial<typeof t.agents.$inferInsert> = {}) {
    const agent = await seedAgent(agentOver);
    const { review, pr } = await seedReview(agent.id);
    const caseIds: string[] = [];
    for (let i = 0; i < n; i++) {
      const f = await seedFinding(review.id);
      const res = await app.inject({ method: 'POST', url: `/findings/${f.id}/eval-case` });
      expect(res.statusCode).toBe(201);
      caseIds.push(res.json().id);
    }
    return { agent, review, pr, caseIds };
  }

  const startSet = (agentId: string) => app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
  const getBatch = async (id: string) => (await app.inject({ method: 'GET', url: `/eval-runs/${id}` })).json();

  async function waitBatch(id: string, until: (b: any) => boolean = (b) => b.status !== 'running', timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const b = await getBatch(id);
      if (until(b)) return b;
      if (Date.now() > deadline) throw new Error(`batch ${id} never reached the condition (last status ${b.status})`);
      await sleep(15);
    }
  }

  async function waitFor(cond: () => boolean, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (!cond()) {
      if (Date.now() > deadline) throw new Error('condition never became true');
      await sleep(15);
    }
  }

  const countCases = async (ownerId: string) =>
    (await db.select().from(t.evalCases).where(eq(t.evalCases.ownerId, ownerId))).length;

  // ---- case creation (AC-3..AC-13) ---------------------------------------------

  describe('case creation', () => {
    it('201: an accepted finding becomes a must_find case owned by the review agent, with a frozen single-file diff', async () => {
      const agent = await seedAgent();
      const { review } = await seedReview(agent.id);
      const f = await seedFinding(review.id, { decided: 'accepted' });

      const res = await app.inject({ method: 'POST', url: `/findings/${f.id}/eval-case` });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.owner_kind).toBe('agent');
      expect(body.owner_id).toBe(agent.id);
      expect(body.source_finding_id).toBe(f.id);
      expect(body.expectation).toMatchObject({ type: 'must_find', file: 'src/config.ts', start_line: 11, end_line: 11 });
      expect(body.name).toBe(`Must find: ${f.title}`);

      const [row] = await db.select().from(t.evalCases).where(eq(t.evalCases.id, body.id));
      expect(row!.ownerId).toBe(review.agentId);
      expect(row!.inputFiles).toBeNull();
      // Only this file's section is frozen (AC-5).
      expect(row!.inputDiff).toContain('src/config.ts');
      expect(row!.inputDiff).toContain('stripeKey');
      expect(row!.inputDiff).not.toContain('other.ts');
      const meta = row!.inputMeta as { pr: Record<string, unknown>; finding: Record<string, unknown> };
      expect(Object.keys(meta.pr).sort()).toEqual(['base', 'body', 'head_sha', 'number', 'repo', 'title']);
      expect(Object.keys(meta.finding).sort()).toEqual(
        [
          'category', 'confidence', 'decided_at', 'decision', 'end_line', 'file', 'id', 'kind', 'rationale',
          'review_id', 'run_id', 'severity', 'start_line', 'suggestion', 'title',
        ].sort(),
      );
      expect(meta.finding.decision).toBe('accepted');
    });

    it('201: a dismissed finding becomes a must_not_flag case', async () => {
      const agent = await seedAgent();
      const { review } = await seedReview(agent.id);
      const f = await seedFinding(review.id, { decided: 'dismissed' });
      const res = await app.inject({ method: 'POST', url: `/findings/${f.id}/eval-case` });
      expect(res.statusCode).toBe(201);
      expect(res.json().expectation.type).toBe('must_not_flag');
      expect(res.json().name).toMatch(/^Must not flag: /);
    });

    it('409 already_eval_case with the existing case_id, and no second row', async () => {
      const agent = await seedAgent();
      const { review } = await seedReview(agent.id);
      const f = await seedFinding(review.id);
      const first = await app.inject({ method: 'POST', url: `/findings/${f.id}/eval-case` });
      const second = await app.inject({ method: 'POST', url: `/findings/${f.id}/eval-case` });
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe('already_eval_case');
      expect(second.json().error.details.case_id).toBe(first.json().id);
      expect(await countCases(agent.id)).toBe(1);
    });

    it('422 finding_undecided creates nothing', async () => {
      const agent = await seedAgent();
      const { review } = await seedReview(agent.id);
      const f = await seedFinding(review.id, { decided: null });
      const res = await app.inject({ method: 'POST', url: `/findings/${f.id}/eval-case` });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('finding_undecided');
      expect(await countCases(agent.id)).toBe(0);
    });

    it('422 agent_missing when the review has no live agent', async () => {
      const { review } = await seedReview('00000000-0000-4000-8000-000000000001');
      const f = await seedFinding(review.id);
      const res = await app.inject({ method: 'POST', url: `/findings/${f.id}/eval-case` });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('agent_missing');

      const { review: orphan } = await seedReview(null);
      const f2 = await seedFinding(orphan.id);
      const res2 = await app.inject({ method: 'POST', url: `/findings/${f2.id}/eval-case` });
      expect(res2.json().error.code).toBe('agent_missing');
    });

    it('422 file_not_in_diff when the finding file has no hunk in the PR diff', async () => {
      const agent = await seedAgent();
      const { review } = await seedReview(agent.id);
      const f = await seedFinding(review.id, { file: 'src/gone.ts' });
      const res = await app.inject({ method: 'POST', url: `/findings/${f.id}/eval-case` });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('file_not_in_diff');
      expect(await countCases(agent.id)).toBe(0);
    });

    it('422 diff_too_large when the file section exceeds the cap', async () => {
      gitOpts.diff = `diff --git a/src/big.ts b/src/big.ts\n--- a/src/big.ts\n+++ b/src/big.ts\n@@ -1,1 +1,2 @@\n a\n+${'x'.repeat(200_100)}`;
      const agent = await seedAgent();
      const { review } = await seedReview(agent.id);
      const f = await seedFinding(review.id, { file: 'src/big.ts', startLine: 2, endLine: 2 });
      const res = await app.inject({ method: 'POST', url: `/findings/${f.id}/eval-case` });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('diff_too_large');
      expect(await countCases(agent.id)).toBe(0);
    });

    it('eval_case_id is on the accept response and the PR reviews list once a case exists (AC-13)', async () => {
      const agent = await seedAgent();
      const { review, pr } = await seedReview(agent.id);
      const f = await seedFinding(review.id, { decided: null });

      const before = await app.inject({ method: 'POST', url: `/findings/${f.id}/accept` });
      expect(before.json().finding.eval_case_id).toBeNull();

      const created = await app.inject({ method: 'POST', url: `/findings/${f.id}/eval-case` });
      expect(created.statusCode).toBe(201);

      const again = await app.inject({ method: 'POST', url: `/findings/${f.id}/accept` });
      expect(again.json().finding.eval_case_id).toBe(created.json().id);

      const reviews = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` });
      expect(reviews.json()[0].findings[0].eval_case_id).toBe(created.json().id);
    });
  });

  // ---- tenancy (AC-73) and validation (AC-74) ------------------------------------

  describe('workspace scoping and validation', () => {
    it('404 for unknown ids and for another workspace, revealing nothing (AC-73)', async () => {
      const [ws2] = await db.insert(t.workspaces).values({ name: `Other ${seq++}` }).returning();
      const agent2 = await seedAgent({}, ws2!.id);
      const { review: review2 } = await seedReview(agent2.id, ws2!.id);
      const finding2 = await seedFinding(review2.id);
      const [case2] = await db
        .insert(t.evalCases)
        .values({
          workspaceId: ws2!.id,
          ownerKind: 'agent',
          ownerId: agent2.id,
          name: 'foreign',
          inputDiff: DIFF,
          expectedOutput: {},
          sourceFindingId: finding2.id,
        })
        .returning();
      const [batch2] = await db
        .insert(t.evalBatches)
        .values({
          workspaceId: ws2!.id,
          agentId: agent2.id,
          scope: 'set',
          agentVersion: 1,
          configSnapshot: {},
          status: 'done',
          casesTotal: 1,
        })
        .returning();

      const random = '11111111-1111-4111-8111-111111111111';
      const probes: Array<[string, string]> = [
        ['POST', `/findings/${finding2.id}/eval-case`],
        ['POST', `/findings/${random}/eval-case`],
        ['GET', `/eval-cases/${case2!.id}`],
        ['GET', `/eval-cases/${random}`],
        ['DELETE', `/eval-cases/${case2!.id}`],
        ['POST', `/eval-cases/${case2!.id}/run`],
        ['GET', `/agents/${agent2.id}/eval-cases`],
        ['GET', `/agents/${agent2.id}/eval-runs`],
        ['GET', `/agents/${agent2.id}/eval-dashboard`],
        ['POST', `/agents/${agent2.id}/eval-runs`],
        ['GET', `/eval-runs/${batch2!.id}`],
        ['GET', `/eval-runs/${random}`],
      ];
      for (const [method, url] of probes) {
        const res = await app.inject({ method: method as 'GET', url });
        expect(res.statusCode, `${method} ${url}`).toBe(404);
        expect(res.json().error.code).toBe('not_found');
      }
      // The foreign case must be untouched.
      expect(await countCases(agent2.id)).toBe(1);

      const cmp = await app.inject({ method: 'GET', url: `/eval-runs/compare?base=${batch2!.id}&head=${batch2!.id}` });
      expect(cmp.statusCode).toBe(404);
    });

    it('422 for a non-uuid batch id (AC-74)', async () => {
      const res = await app.inject({ method: 'GET', url: '/eval-runs/not-a-uuid' });
      expect(res.statusCode).toBe(422);
    });
  });

  // ---- running batches -----------------------------------------------------------

  describe('running batches', () => {
    it('202 immediately while the run is still going (AC-28), then reaches done', async () => {
      const { agent } = await agentWithCases(1);
      llm.close();
      const res = await startSet(agent.id);
      expect(res.statusCode).toBe(202);
      const batchId = res.json().batch_id as string;

      const running = await getBatch(batchId);
      expect(running.status).toBe('running');
      expect(running.finished_at).toBeNull();
      expect(running.cases_total).toBe(1);

      llm.open();
      const done = await waitBatch(batchId);
      expect(done.status).toBe('done');
    });

    it('409 batch_running on back-to-back POSTs, for both run endpoints (AC-30)', async () => {
      const { agent, caseIds } = await agentWithCases(2);
      llm.close();
      const first = await startSet(agent.id);
      expect(first.statusCode).toBe(202);
      const batchId = first.json().batch_id;

      const second = await startSet(agent.id);
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe('batch_running');
      expect(second.json().error.details.batch_id).toBe(batchId);
      expect(second.json().error.details.scope).toBe('set');

      const viaCase = await app.inject({ method: 'POST', url: `/eval-cases/${caseIds[0]}/run` });
      expect(viaCase.statusCode).toBe(409);
      expect(viaCase.json().error.code).toBe('batch_running');
      expect(viaCase.json().error.details.batch_id).toBe(batchId);

      const rows = await db.select().from(t.evalBatches).where(eq(t.evalBatches.agentId, agent.id));
      expect(rows).toHaveLength(1);

      llm.open();
      await waitBatch(batchId);
    });

    it('409 batch_running reports the scope of the running batch', async () => {
      const { agent, caseIds } = await agentWithCases(2);
      llm.close();
      const first = await app.inject({ method: 'POST', url: `/eval-cases/${caseIds[0]}/run` });
      expect(first.statusCode).toBe(202);
      const batchId = first.json().batch_id;

      const second = await startSet(agent.id);
      expect(second.statusCode).toBe(409);
      expect(second.json().error.details).toMatchObject({ batch_id: batchId, scope: 'case' });

      llm.open();
      await waitBatch(batchId);
    });

    it('two simultaneous POSTs yield exactly one batch (partial unique index)', async () => {
      const { agent } = await agentWithCases(1);
      llm.close();
      const [a, b] = await Promise.all([startSet(agent.id), startSet(agent.id)]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([202, 409]);
      const rows = await db.select().from(t.evalBatches).where(eq(t.evalBatches.agentId, agent.id));
      expect(rows).toHaveLength(1);
      llm.open();
      await waitBatch(rows[0]!.id);
    });

    it('422 no_eval_cases and no batch row', async () => {
      const agent = await seedAgent();
      const res = await startSet(agent.id);
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('no_eval_cases');
      expect(await db.select().from(t.evalBatches).where(eq(t.evalBatches.agentId, agent.id))).toHaveLength(0);
    });

    it('cases_done grows one case at a time (AC-33)', async () => {
      const { agent } = await agentWithCases(2);
      llm.close();
      const res = await startSet(agent.id);
      const batchId = res.json().batch_id as string;

      await waitFor(() => llm.arrived >= 1);
      expect((await getBatch(batchId)).cases_done).toBe(0);

      llm.releaseOne();
      const mid = await waitBatch(batchId, (b) => b.cases_done === 1);
      expect(mid.status).toBe('running');
      expect(mid.runs).toHaveLength(1);

      llm.open();
      const done = await waitBatch(batchId);
      expect(done.cases_done).toBe(2);
    });

    it('a done batch exposes aggregates and one run per case on the first terminal poll (AC-36)', async () => {
      // One must_find (recall) and one must_not_flag (precision) case; the fixture
      // finding sits on both, so the first passes and the second fails.
      const { agent, review } = await agentWithCases(1);
      const dismissed = await seedFinding(review.id, { decided: 'dismissed' });
      expect((await app.inject({ method: 'POST', url: `/findings/${dismissed.id}/eval-case` })).statusCode).toBe(201);
      const batchId = (await startSet(agent.id)).json().batch_id as string;
      const done = await waitBatch(batchId);

      expect(done.status).toBe('done');
      expect(done.finished_at).not.toBeNull();
      expect(done.duration_ms).not.toBeNull();
      expect(done.recall).not.toBeNull();
      expect(done.precision).not.toBeNull();
      expect(done.citation_accuracy).not.toBeNull();
      expect(done.traces_total).toBe(2);
      expect(done.runs).toHaveLength(done.cases_total);
      expect(done.traces_passed).toBe(1);
      expect(done.recall).toBe(1);
      expect(done.precision).toBe(0);
      expect(done.citation_accuracy).toBe(1);
      expect(done.config_snapshot).toMatchObject({ provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review the diff.' });
    });

    it('an unconfigured provider fails the batch without running any case (AC-35)', async () => {
      const { agent } = await agentWithCases(1, { provider: 'anthropic', model: 'claude-sonnet-4-5' });
      const res = await startSet(agent.id);
      expect(res.statusCode).toBe(202);
      const batch = await waitBatch(res.json().batch_id);
      expect(batch.status).toBe('failed');
      expect(batch.error).toBeTruthy();
      expect(batch.runs).toHaveLength(0);
      expect(llm.arrived).toBe(0);
    });

    it('a case-scope run is a batch of its own and stays out of the agent run list (AC-37, AC-38)', async () => {
      const { agent, caseIds } = await agentWithCases(2);

      const caseRun = await app.inject({ method: 'POST', url: `/eval-cases/${caseIds[0]}/run` });
      expect(caseRun.statusCode).toBe(202);
      const caseBatch = await waitBatch(caseRun.json().batch_id);
      expect(caseBatch.scope).toBe('case');
      expect(caseBatch.cases_total).toBe(1);
      expect(caseBatch.runs).toHaveLength(1);

      const setBatch = await waitBatch((await startSet(agent.id)).json().batch_id);
      expect(setBatch.scope).toBe('set');

      const list = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs` })).json();
      expect(list.map((b: any) => b.id)).toEqual([setBatch.id]);

      // last_result reflects the latest run of either scope (selectDistinctOn).
      const cases = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` })).json();
      expect(cases).toHaveLength(2);
      for (const c of cases) expect(c.last_result).toMatchObject({ pass: true, matched_count: 1, actual_count: 1 });
    });

    it('a batch running longer than 30 minutes that this process does not own is stale, so a new run starts (AC-42)', async () => {
      const { agent } = await agentWithCases(1);
      const [stale] = await db
        .insert(t.evalBatches)
        .values({
          workspaceId,
          agentId: agent.id,
          scope: 'set',
          agentVersion: agent.version,
          configSnapshot: {},
          status: 'running',
          casesTotal: 1,
          startedAt: new Date(Date.now() - 31 * 60_000),
        })
        .returning();

      const res = await startSet(agent.id);
      expect(res.statusCode).toBe(202);
      await waitBatch(res.json().batch_id);

      const [after] = await db.select().from(t.evalBatches).where(eq(t.evalBatches.id, stale!.id));
      expect(after!.status).toBe('failed');
      expect(after!.error).toMatch(/stale/);
    });

    it('a recent running batch is not stale (409)', async () => {
      const { agent } = await agentWithCases(1);
      await db.insert(t.evalBatches).values({
        workspaceId,
        agentId: agent.id,
        scope: 'set',
        agentVersion: 1,
        configSnapshot: {},
        status: 'running',
        casesTotal: 1,
        startedAt: new Date(Date.now() - 5 * 60_000),
      });
      const res = await startSet(agent.id);
      expect(res.statusCode).toBe(409);
    });
  });

  // ---- deleting cases (AC-23, AC-24) ---------------------------------------------

  describe('deleting cases', () => {
    it('removes the case and its runs but leaves batch aggregates untouched (AC-23)', async () => {
      const { agent, caseIds } = await agentWithCases(2);
      const done = await waitBatch((await startSet(agent.id)).json().batch_id);

      const del = await app.inject({ method: 'DELETE', url: `/eval-cases/${caseIds[0]}` });
      expect(del.statusCode).toBe(204);

      expect(await db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, caseIds[0]!))).toHaveLength(0);
      const after = await getBatch(done.id);
      expect(after.recall).toBe(done.recall);
      expect(after.precision).toBe(done.precision);
      expect(after.traces_passed).toBe(done.traces_passed);
      expect(after.traces_total).toBe(done.traces_total);
      expect(after.runs).toHaveLength(1);
      expect((await app.inject({ method: 'GET', url: `/eval-cases/${caseIds[0]}` })).statusCode).toBe(404);
    });

    it('409 while a batch of the owner agent is running (AC-24)', async () => {
      const { agent, caseIds } = await agentWithCases(1);
      llm.close();
      const batchId = (await startSet(agent.id)).json().batch_id as string;

      const del = await app.inject({ method: 'DELETE', url: `/eval-cases/${caseIds[0]}` });
      expect(del.statusCode).toBe(409);
      expect(del.json().error.code).toBe('batch_running');
      expect(await countCases(agent.id)).toBe(1);

      llm.open();
      await waitBatch(batchId);
    });
  });

  // ---- compare, dashboards, run-all ----------------------------------------------

  describe('compare, dashboards and run-all', () => {
    it('compare: 200 for two done set batches of one agent, 422 otherwise (AC-60)', async () => {
      const { agent } = await agentWithCases(1);
      const first = await waitBatch((await startSet(agent.id)).json().batch_id);
      await db.update(t.agents).set({ systemPrompt: 'Review the diff.\nBe strict.' }).where(eq(t.agents.id, agent.id));
      const second = await waitBatch((await startSet(agent.id)).json().batch_id);

      const ok = await app.inject({ method: 'GET', url: `/eval-runs/compare?base=${first.id}&head=${second.id}` });
      expect(ok.statusCode).toBe(200);
      const body = ok.json();
      expect(body.base.id).toBe(first.id);
      expect(body.head.id).toBe(second.id);
      expect(body.model_changed).toBe(false);
      expect(body.prompt_diff.filter((l: any) => l.op === 'add').map((l: any) => l.text)).toEqual(['Be strict.']);

      // Different agents.
      const other = await agentWithCases(1);
      const otherDone = await waitBatch((await startSet(other.agent.id)).json().batch_id);
      const diffAgents = await app.inject({ method: 'GET', url: `/eval-runs/compare?base=${first.id}&head=${otherDone.id}` });
      expect(diffAgents.statusCode).toBe(422);
      expect(diffAgents.json().error.code).toBe('different_agents');

      // A non-done batch.
      const [failed] = await db
        .insert(t.evalBatches)
        .values({
          workspaceId,
          agentId: agent.id,
          scope: 'set',
          agentVersion: 1,
          configSnapshot: {},
          status: 'failed',
          casesTotal: 1,
        })
        .returning();
      const notDone = await app.inject({ method: 'GET', url: `/eval-runs/compare?base=${first.id}&head=${failed!.id}` });
      expect(notDone.statusCode).toBe(422);
      expect(notDone.json().error.code).toBe('not_comparable');
    });

    it('agent dashboard: current, trend and recent batches come from done set batches', async () => {
      const { agent } = await agentWithCases(1);
      const none = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-dashboard` })).json();
      expect(none.current).toBeNull();
      expect(none.cases_total).toBe(1);
      expect(none.trend).toEqual([]);

      await waitBatch((await startSet(agent.id)).json().batch_id);
      await waitBatch((await startSet(agent.id)).json().batch_id);
      const dash = (await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-dashboard` })).json();
      // Only a must_find case exists, so precision is "not computed" (null), never 0.
      expect(dash.current).toMatchObject({ recall: 1, precision: null, traces_passed: 1, traces_total: 1 });
      expect(dash.trend).toHaveLength(2);
      expect(dash.recent_batches).toHaveLength(2);
      expect(dash.running_batch_id).toBeNull();
      expect(dash.alert).toBeNull();
    });

    it('workspace dashboard: one row per agent with its last batch, plus the latest set batches (AC-63, AC-64)', async () => {
      const { agent } = await agentWithCases(1);
      const idle = await seedAgent();
      const done = await waitBatch((await startSet(agent.id)).json().batch_id);
      await waitBatch((await startSet(agent.id)).json().batch_id);

      const dash = (await app.inject({ method: 'GET', url: '/eval-dashboard' })).json();
      const row = dash.agents.find((a: any) => a.agent_id === agent.id);
      expect(row.agent_name).toBe(agent.name);
      expect(row.cases_total).toBe(1);
      expect(row.last_batch.status).toBe('done');
      expect(row.last_batch.id).not.toBe(done.id); // newest first
      expect(row.sparkline).toEqual([1, 1]);

      const idleRow = dash.agents.find((a: any) => a.agent_id === idle.id);
      expect(idleRow.cases_total).toBe(0);
      expect(idleRow.last_batch).toBeNull();
      expect(idleRow.sparkline).toEqual([]);

      expect(dash.recent_batches.length).toBeLessThanOrEqual(20);
      expect(dash.recent_batches.some((b: any) => b.id === done.id)).toBe(true);
      expect(dash.recent_batches.every((b: any) => b.scope === 'set')).toBe(true);
    });

    it('run-all starts the idle agent with cases and skips running and case-less ones (AC-65)', async () => {
      const startable = await agentWithCases(1);
      const busy = await agentWithCases(1);
      const empty = await seedAgent();
      // Run-all spans the whole workspace: drop the cases earlier tests left behind.
      await db
        .delete(t.evalCases)
        .where(notInArray(t.evalCases.ownerId, [startable.agent.id, busy.agent.id]));
      await db.insert(t.evalBatches).values({
        workspaceId,
        agentId: busy.agent.id,
        scope: 'set',
        agentVersion: 1,
        configSnapshot: {},
        status: 'running',
        casesTotal: 1,
      });

      const res = await app.inject({ method: 'POST', url: '/eval-runs/all' });
      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.started).toHaveLength(1);
      expect(body.started[0].agent_id).toBe(startable.agent.id);
      expect(body.skipped).toContainEqual({ agent_id: busy.agent.id, reason: 'running' });
      expect(body.skipped).toContainEqual({ agent_id: empty.id, reason: 'no_cases' });

      const done = await waitBatch(body.started[0].batch_id);
      expect(done.status).toBe('done');
    });
  });

  // ---- cascades (AC-71, AC-72) ---------------------------------------------------

  describe('cascades', () => {
    it('deleting an agent removes its cases, batches and runs, and only its own (AC-71)', async () => {
      const mine = await agentWithCases(2);
      const keep = await agentWithCases(1);
      await waitBatch((await startSet(mine.agent.id)).json().batch_id);
      await waitBatch((await startSet(keep.agent.id)).json().batch_id);

      const del = await app.inject({ method: 'DELETE', url: `/agents/${mine.agent.id}` });
      expect(del.statusCode).toBe(200);

      expect(await countCases(mine.agent.id)).toBe(0);
      expect(await db.select().from(t.evalBatches).where(eq(t.evalBatches.agentId, mine.agent.id))).toHaveLength(0);
      const orphanRuns = await db
        .select()
        .from(t.evalRuns)
        .where(sql`${t.evalRuns.caseId} in (${sql.join(mine.caseIds.map((c) => sql`${c}::uuid`), sql`, `)})`);
      expect(orphanRuns).toHaveLength(0);

      // The other agent keeps everything.
      expect(await countCases(keep.agent.id)).toBe(1);
      expect(await db.select().from(t.evalBatches).where(eq(t.evalBatches.agentId, keep.agent.id))).toHaveLength(1);
      expect(await db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, keep.caseIds[0]!))).toHaveLength(1);
    });

    it('deleting the source review keeps the case, clears source_finding_id and it still runs (AC-72)', async () => {
      const { agent, review, caseIds } = await agentWithCases(1);

      const del = await app.inject({ method: 'DELETE', url: `/reviews/${review.id}` });
      expect(del.statusCode).toBe(200);

      const [row] = await db.select().from(t.evalCases).where(and(eq(t.evalCases.id, caseIds[0]!)));
      expect(row).toBeDefined();
      expect(row!.sourceFindingId).toBeNull();

      const dto = (await app.inject({ method: 'GET', url: `/eval-cases/${caseIds[0]}` })).json();
      expect(dto.source_finding_id).toBeNull();

      const done = await waitBatch((await startSet(agent.id)).json().batch_id);
      expect(done.status).toBe('done');
      expect(done.runs).toHaveLength(1);
    });
  });
});
