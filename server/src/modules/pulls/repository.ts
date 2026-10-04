import { and, desc, eq, inArray } from 'drizzle-orm';
import type { PrDetail, PrMeta } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * F1 — pulls data-access layer. The ONLY place in the pulls module that touches
 * `pull_requests`, `pr_files`, `pr_commits` (and the read-side aggregates over
 * `reviews` / `findings` / `agent_runs` used by the PR list). Every lookup that
 * starts from a caller-supplied id is scoped by `workspaceId` (tenancy guard).
 */

export type PullRow = typeof t.pullRequests.$inferSelect;
export type RepoRow = typeof t.repos.$inferSelect;
export type PrFileRow = typeof t.prFiles.$inferSelect;
export type PrCommitRow = typeof t.prCommits.$inferSelect;

export interface FindingBuckets {
  CRITICAL: number;
  WARNING: number;
  SUGGESTION: number;
}

export class PullsRepository {
  constructor(private db: Db) {}

  async findRepo(workspaceId: string, repoId: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /** Repo of an already workspace-checked PR (looked up by id only). */
  async findRepoOfPull(pr: PullRow): Promise<RepoRow | undefined> {
    const [row] = await this.db.select().from(t.repos).where(eq(t.repos.id, pr.repoId));
    return row;
  }

  async findById(workspaceId: string, id: string): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, id)));
    return row;
  }

  /** Look a PR up by its GitHub number within a repo of the workspace. */
  async findByNumber(
    workspaceId: string,
    repoId: string,
    number: number,
  ): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.pullRequests.repoId, repoId),
          eq(t.pullRequests.number, number),
        ),
      );
    return row;
  }

  async listByRepo(repoId: string): Promise<PullRow[]> {
    return this.db.select().from(t.pullRequests).where(eq(t.pullRequests.repoId, repoId));
  }

  /** Idempotent import of one list-payload PR (unique repo_id + number). */
  async upsertFromList(workspaceId: string, repoId: string, pr: PrMeta): Promise<void> {
    await this.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: pr.number,
        title: pr.title,
        author: pr.author,
        branch: pr.branch,
        base: pr.base,
        headSha: pr.head_sha,
        additions: pr.additions,
        deletions: pr.deletions,
        filesCount: pr.files_count,
        status: pr.status,
        openedAt: pr.opened_at ? new Date(pr.opened_at) : null,
        updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
      })
      .onConflictDoUpdate({
        target: [t.pullRequests.repoId, t.pullRequests.number],
        set: {
          title: pr.title,
          headSha: pr.head_sha,
          status: pr.status,
          updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
        },
      });
  }

  async updateStats(
    id: string,
    stats: { additions: number; deletions: number; filesCount: number },
  ): Promise<void> {
    await this.db.update(t.pullRequests).set(stats).where(eq(t.pullRequests.id, id));
  }

  /** Replace files + commits and refresh body/diff stats from a GitHub detail payload. */
  async replaceDetail(prId: string, detail: PrDetail): Promise<void> {
    await this.db.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
    if (detail.files.length > 0) {
      await this.db.insert(t.prFiles).values(
        detail.files.map((f) => ({
          prId,
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? null,
        })),
      );
    }
    await this.db.delete(t.prCommits).where(eq(t.prCommits.prId, prId));
    if (detail.commits.length > 0) {
      await this.db.insert(t.prCommits).values(
        detail.commits.map((c) => ({
          prId,
          sha: c.sha,
          message: c.message,
          author: c.author,
          committedAt: c.committed_at ? new Date(c.committed_at) : null,
        })),
      );
    }
    await this.db
      .update(t.pullRequests)
      .set({
        body: detail.body ?? null,
        additions: detail.additions,
        deletions: detail.deletions,
        filesCount: detail.files_count,
      })
      .where(eq(t.pullRequests.id, prId));
  }

  async listFiles(prId: string): Promise<PrFileRow[]> {
    return this.db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
  }

  async listCommits(prId: string): Promise<PrCommitRow[]> {
    return this.db.select().from(t.prCommits).where(eq(t.prCommits.prId, prId));
  }

  /** Latest `review`-kind review (id + score) per PR. */
  async latestReviewsByPr(
    prIds: string[],
  ): Promise<Map<string, { score: number | null; reviewId: string }>> {
    const out = new Map<string, { score: number | null; reviewId: string }>();
    if (prIds.length === 0) return out;
    const rows = await this.db
      .select({ prId: t.reviews.prId, score: t.reviews.score, id: t.reviews.id })
      .from(t.reviews)
      .where(and(inArray(t.reviews.prId, prIds), eq(t.reviews.kind, 'review')))
      .orderBy(desc(t.reviews.createdAt));
    // Rows are newest-first → first seen per PR is the latest review.
    for (const rv of rows) {
      if (!out.has(rv.prId)) out.set(rv.prId, { score: rv.score, reviewId: rv.id });
    }
    return out;
  }

  async findingSeverities(reviewIds: string[]): Promise<{ reviewId: string; severity: string }[]> {
    if (reviewIds.length === 0) return [];
    return this.db
      .select({ reviewId: t.findings.reviewId, severity: t.findings.severity })
      .from(t.findings)
      .where(inArray(t.findings.reviewId, reviewIds));
  }

  async runCosts(prIds: string[]): Promise<{ prId: string | null; costUsd: number | null }[]> {
    if (prIds.length === 0) return [];
    return this.db
      .select({ prId: t.agentRuns.prId, costUsd: t.agentRuns.costUsd })
      .from(t.agentRuns)
      .where(inArray(t.agentRuns.prId, prIds));
  }
}
