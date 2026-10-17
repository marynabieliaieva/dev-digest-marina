import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { AgentColumn, AgentColumnFinding } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { toColumnStatus } from './helpers.js';

export interface MultiRunMeta {
  id: string;
  prId: string;
  prNumber: number | null;
  ranAt: string;
}

export interface EstimateSample {
  durationMs: number | null;
  costUsd: number | null;
}

/** Persistence for multi-agent runs. Every query is workspace-scoped. */
export class MultiAgentRepository {
  constructor(private db: Db) {}

  /** Id + number of a PR in the workspace, or undefined. */
  async getPull(workspaceId: string, prId: string): Promise<{ id: string; number: number } | undefined> {
    const [row] = await this.db
      .select({ id: t.pullRequests.id, number: t.pullRequests.number })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  async createMultiRun(workspaceId: string, prId: string): Promise<string> {
    const [row] = await this.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId })
      .returning({ id: t.multiAgentRuns.id });
    return row!.id;
  }

  async deleteMultiRun(workspaceId: string, multiRunId: string): Promise<void> {
    await this.db
      .delete(t.multiAgentRuns)
      .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.id, multiRunId)));
  }

  async linkRuns(workspaceId: string, multiRunId: string, runIds: string[]): Promise<void> {
    if (runIds.length === 0) return;
    await this.db
      .update(t.agentRuns)
      .set({ multiRunId })
      .where(and(eq(t.agentRuns.workspaceId, workspaceId), inArray(t.agentRuns.id, runIds)));
  }

  async getMultiRun(workspaceId: string, multiRunId: string): Promise<MultiRunMeta | undefined> {
    const [row] = await this.db
      .select({
        id: t.multiAgentRuns.id,
        prId: t.multiAgentRuns.prId,
        prNumber: t.pullRequests.number,
        ranAt: t.multiAgentRuns.ranAt,
      })
      .from(t.multiAgentRuns)
      .leftJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
      .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.id, multiRunId)));
    return row && { ...row, ranAt: row.ranAt.toISOString() };
  }

  async latestMultiRunForPull(workspaceId: string, prId: string): Promise<MultiRunMeta | undefined> {
    const [row] = await this.db
      .select({ id: t.multiAgentRuns.id })
      .from(t.multiAgentRuns)
      .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.prId, prId)))
      .orderBy(desc(t.multiAgentRuns.ranAt))
      .limit(1);
    return row ? this.getMultiRun(workspaceId, row.id) : undefined;
  }

  /**
   * The child runs as columns, in selection order (`ran_at asc, id asc`). Only `done`
   * columns carry findings; `findings_count` is null while running.
   */
  async columns(workspaceId: string, multiRunId: string): Promise<AgentColumn[]> {
    const runs = await this.db
      .select({
        runId: t.agentRuns.id,
        agentId: t.agentRuns.agentId,
        agentName: t.agents.name,
        provider: t.agentRuns.provider,
        model: t.agentRuns.model,
        status: t.agentRuns.status,
        error: t.agentRuns.error,
        durationMs: t.agentRuns.durationMs,
        costUsd: t.agentRuns.costUsd,
        tokensIn: t.agentRuns.tokensIn,
        tokensOut: t.agentRuns.tokensOut,
        findingsCount: t.agentRuns.findingsCount,
        score: t.agentRuns.score,
      })
      .from(t.agentRuns)
      .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
      .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.multiRunId, multiRunId)))
      .orderBy(asc(t.agentRuns.ranAt), asc(t.agentRuns.id));
    if (runs.length === 0) return [];

    const runIds = runs.map((r) => r.runId);
    const reviewRows = await this.db
      .select({
        id: t.reviews.id,
        runId: t.reviews.runId,
        verdict: t.reviews.verdict,
        summary: t.reviews.summary,
        score: t.reviews.score,
      })
      .from(t.reviews)
      .where(
        and(eq(t.reviews.workspaceId, workspaceId), eq(t.reviews.kind, 'review'), inArray(t.reviews.runId, runIds)),
      );
    const reviewByRun = new Map<string, (typeof reviewRows)[number]>();
    for (const r of reviewRows) if (r.runId && !reviewByRun.has(r.runId)) reviewByRun.set(r.runId, r);

    const reviewIds = [...reviewByRun.values()].map((r) => r.id);
    const findingRows =
      reviewIds.length === 0
        ? []
        : await this.db
            .select({
              reviewId: t.findings.reviewId,
              id: t.findings.id,
              severity: t.findings.severity,
              category: t.findings.category,
              title: t.findings.title,
              file: t.findings.file,
              startLine: t.findings.startLine,
              endLine: t.findings.endLine,
              kind: t.findings.kind,
            })
            .from(t.findings)
            .where(inArray(t.findings.reviewId, reviewIds));
    const findingsByReview = new Map<string, AgentColumnFinding[]>();
    for (const f of findingRows) {
      const list = findingsByReview.get(f.reviewId) ?? [];
      list.push({
        id: f.id,
        severity: f.severity as AgentColumnFinding['severity'],
        category: f.category,
        title: f.title,
        file: f.file,
        start_line: f.startLine,
        end_line: f.endLine,
        kind: f.kind,
      });
      findingsByReview.set(f.reviewId, list);
    }

    return runs.map((r): AgentColumn => {
      const status = toColumnStatus(r.status);
      const review = reviewByRun.get(r.runId);
      return {
        run_id: r.runId,
        agent_id: r.agentId,
        agent_name: r.agentName,
        provider: r.provider,
        model: r.model,
        status,
        error: r.error,
        verdict: review?.verdict ?? null,
        score: review?.score ?? r.score,
        summary: review?.summary ?? null,
        duration_ms: r.durationMs,
        cost_usd: r.costUsd,
        tokens_in: r.tokensIn,
        tokens_out: r.tokensOut,
        findings_count: status === 'running' ? null : r.findingsCount,
        findings: status === 'done' && review ? (findingsByReview.get(review.id) ?? []) : [],
      };
    });
  }

  /** The agent's latest `limit` done runs (newest first), for duration/cost estimates. */
  async recentDoneRuns(workspaceId: string, agentId: string, limit: number): Promise<EstimateSample[]> {
    return this.db
      .select({ durationMs: t.agentRuns.durationMs, costUsd: t.agentRuns.costUsd })
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.agentId, agentId),
          eq(t.agentRuns.status, 'done'),
        ),
      )
      .orderBy(desc(t.agentRuns.ranAt))
      .limit(limit);
  }
}
