import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { BatchAggregates, CaseRecord, EvalExecutorRepo } from './executor.js';

/**
 * Eval data-access. The only layer touching the DB for the eval domain. Owns
 * `eval_cases`, `eval_batches` and `eval_runs`. Workspace scoping is applied on
 * every lookup that starts from a client-supplied id.
 */

export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalBatchRow = typeof t.evalBatches.$inferSelect;
export type EvalRunRow = typeof t.evalRuns.$inferSelect;
export type EvalRunWithCase = EvalRunRow & { caseName: string | null };

export interface InsertCase {
  workspaceId: string;
  agentId: string;
  name: string;
  inputDiff: string;
  inputMeta: unknown;
  expectedOutput: unknown;
  sourceFindingId: string;
}

export interface InsertBatch {
  workspaceId: string;
  agentId: string;
  scope: 'set' | 'case';
  agentVersion: number;
  configSnapshot: unknown;
  casesTotal: number;
}

/** Postgres unique_violation, possibly wrapped (drizzle/postgres-js put it on `cause`). */
export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 3 && e; i++) {
    if ((e as { code?: string }).code === '23505') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export class EvalRepository implements EvalExecutorRepo {
  constructor(private db: Db) {}

  // ---- cases --------------------------------------------------------------

  async insertCase(values: InsertCase): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: 'agent',
        ownerId: values.agentId,
        name: values.name,
        inputDiff: values.inputDiff,
        inputFiles: null,
        inputMeta: values.inputMeta as object,
        expectedOutput: values.expectedOutput as object,
        sourceFindingId: values.sourceFindingId,
      })
      .returning();
    return row!;
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row;
  }

  async findCaseBySource(agentId: string, findingId: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
          eq(t.evalCases.sourceFindingId, findingId),
        ),
      );
    return row;
  }

  /** Agent-owned cases, newest first. */
  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
        ),
      )
      .orderBy(desc(t.evalCases.createdAt), desc(t.evalCases.id));
  }

  async countCases(agentId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.ownerKind, 'agent'), eq(t.evalCases.ownerId, agentId)));
    return row?.n ?? 0;
  }

  /** Case counts per agent for a workspace. */
  async caseCountsByAgent(workspaceId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ agentId: t.evalCases.ownerId, n: sql<number>`count(*)::int` })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'agent')))
      .groupBy(t.evalCases.ownerId);
    return new Map(rows.map((r) => [r.agentId, r.n]));
  }

  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  /** Latest run per case (either batch scope). */
  async lastRunsByCase(caseIds: string[]): Promise<Map<string, EvalRunRow>> {
    if (caseIds.length === 0) return new Map();
    const rows = await this.db
      .selectDistinctOn([t.evalRuns.caseId])
      .from(t.evalRuns)
      .where(inArray(t.evalRuns.caseId, caseIds))
      .orderBy(t.evalRuns.caseId, desc(t.evalRuns.ranAt));
    return new Map(rows.map((r) => [r.caseId, r]));
  }

  // ---- batches ------------------------------------------------------------

  async insertBatch(values: InsertBatch): Promise<EvalBatchRow> {
    const [row] = await this.db
      .insert(t.evalBatches)
      .values({
        workspaceId: values.workspaceId,
        agentId: values.agentId,
        scope: values.scope,
        agentVersion: values.agentVersion,
        configSnapshot: values.configSnapshot as object,
        status: 'running',
        casesTotal: values.casesTotal,
      })
      .returning();
    return row!;
  }

  async getBatch(workspaceId: string, id: string): Promise<EvalBatchRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalBatches)
      .where(and(eq(t.evalBatches.workspaceId, workspaceId), eq(t.evalBatches.id, id)));
    return row;
  }

  /** Running batches of one agent (at most one, by the partial unique index). */
  async runningBatches(agentId: string): Promise<EvalBatchRow[]> {
    return this.db
      .select()
      .from(t.evalBatches)
      .where(and(eq(t.evalBatches.agentId, agentId), eq(t.evalBatches.status, 'running')));
  }

  /** Running batches across the workspace (stale sweep + dashboards). */
  async runningBatchesInWorkspace(workspaceId: string): Promise<EvalBatchRow[]> {
    return this.db
      .select()
      .from(t.evalBatches)
      .where(and(eq(t.evalBatches.workspaceId, workspaceId), eq(t.evalBatches.status, 'running')));
  }

  /** Newest first. `statuses` filters (e.g. only `done`). */
  async listBatches(
    agentId: string,
    opts: { scope?: 'set' | 'case'; status?: 'running' | 'done' | 'failed'; limit: number },
  ): Promise<EvalBatchRow[]> {
    const conds = [eq(t.evalBatches.agentId, agentId)];
    if (opts.scope) conds.push(eq(t.evalBatches.scope, opts.scope));
    if (opts.status) conds.push(eq(t.evalBatches.status, opts.status));
    return this.db
      .select()
      .from(t.evalBatches)
      .where(and(...conds))
      .orderBy(desc(t.evalBatches.startedAt), desc(t.evalBatches.id))
      .limit(opts.limit);
  }

  /** Latest `set` batches across the workspace, newest first. */
  async recentSetBatches(workspaceId: string, limit: number): Promise<EvalBatchRow[]> {
    return this.db
      .select()
      .from(t.evalBatches)
      .where(and(eq(t.evalBatches.workspaceId, workspaceId), eq(t.evalBatches.scope, 'set')))
      .orderBy(desc(t.evalBatches.startedAt), desc(t.evalBatches.id))
      .limit(limit);
  }

  /** Last `perAgent` done `set` batches for each of the given agents, newest first. */
  async doneSetBatchesForAgents(agentIds: string[], perAgent: number): Promise<EvalBatchRow[]> {
    if (agentIds.length === 0) return [];
    const ranked = this.db
      .select({
        id: t.evalBatches.id,
        rn: sql<number>`row_number() over (partition by ${t.evalBatches.agentId} order by ${t.evalBatches.startedAt} desc)`.as(
          'rn',
        ),
      })
      .from(t.evalBatches)
      .where(
        and(
          inArray(t.evalBatches.agentId, agentIds),
          eq(t.evalBatches.scope, 'set'),
          eq(t.evalBatches.status, 'done'),
        ),
      )
      .as('ranked');
    const rows = await this.db
      .select({ batch: t.evalBatches })
      .from(t.evalBatches)
      .innerJoin(ranked, eq(ranked.id, t.evalBatches.id))
      .where(sql`${ranked.rn} <= ${perAgent}`)
      .orderBy(desc(t.evalBatches.startedAt));
    return rows.map((r) => r.batch);
  }

  /** Mark stale batches failed. Guarded on `status = 'running'`. */
  async failStale(batchIds: string[], error: string, at: Date): Promise<void> {
    if (batchIds.length === 0) return;
    await this.db
      .update(t.evalBatches)
      .set({ status: 'failed', error, finishedAt: at })
      .where(and(inArray(t.evalBatches.id, batchIds), eq(t.evalBatches.status, 'running')));
  }

  async listRuns(batchId: string): Promise<EvalRunWithCase[]> {
    const rows = await this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalCases.id, t.evalRuns.caseId))
      .where(eq(t.evalRuns.batchId, batchId))
      .orderBy(asc(t.evalRuns.ranAt), asc(t.evalRuns.id));
    return rows.map((r) => ({ ...r.run, caseName: r.caseName }));
  }

  /** Most recent per-case runs across an agent's done set batches. */
  async recentRunsForBatches(batchIds: string[], limit: number): Promise<EvalRunWithCase[]> {
    if (batchIds.length === 0) return [];
    const rows = await this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalCases.id, t.evalRuns.caseId))
      .where(inArray(t.evalRuns.batchId, batchIds))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
    return rows.map((r) => ({ ...r.run, caseName: r.caseName }));
  }

  // ---- executor port ------------------------------------------------------

  async recordCase(batchId: string, r: CaseRecord): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(t.evalRuns).values({
        caseId: r.caseId,
        batchId,
        actualOutput: r.actualOutput as object | null,
        pass: r.pass,
        recall: r.recall,
        precision: r.precision,
        citationAccuracy: r.citationAccuracy,
        durationMs: r.durationMs,
        costUsd: r.costUsd,
        error: r.error,
      });
      await tx
        .update(t.evalBatches)
        .set({ casesDone: sql`${t.evalBatches.casesDone} + 1` })
        .where(eq(t.evalBatches.id, batchId));
    });
  }

  async writeAggregates(batchId: string, a: BatchAggregates): Promise<void> {
    await this.db
      .update(t.evalBatches)
      .set({
        recall: a.recall,
        precision: a.precision,
        citationAccuracy: a.citationAccuracy,
        tracesPassed: a.tracesPassed,
        tracesTotal: a.tracesTotal,
        costUsd: a.costUsd,
      })
      .where(eq(t.evalBatches.id, batchId));
  }

  async markDone(batchId: string, finishedAt: Date, durationMs: number): Promise<void> {
    await this.db
      .update(t.evalBatches)
      .set({ status: 'done', finishedAt, durationMs })
      .where(eq(t.evalBatches.id, batchId));
  }

  async markFailed(batchId: string, error: string, finishedAt: Date, durationMs: number): Promise<void> {
    await this.db
      .update(t.evalBatches)
      .set({ status: 'failed', error, finishedAt, durationMs })
      .where(eq(t.evalBatches.id, batchId));
  }
}
