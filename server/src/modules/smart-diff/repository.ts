import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import * as reviewRepo from '../reviews/repository/review.repo.js';
import type { SmartDiffFileInput, SmartDiffReviewInput } from './helpers.js';

export type { SmartDiffFileInput, SmartDiffReviewInput } from './helpers.js';

/** Smart Diff data-access — read-only over `pull_requests`, `pr_files`, `reviews`, `findings`. */
export class SmartDiffRepository {
  constructor(private db: Db) {}

  /** True iff the PR exists in `workspaceId`. */
  async pullExists(workspaceId: string, prId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.id, prId), eq(t.pullRequests.workspaceId, workspaceId)))
      .limit(1);
    return !!row;
  }

  async listFiles(prId: string): Promise<SmartDiffFileInput[]> {
    return this.db
      .select({ path: t.prFiles.path, additions: t.prFiles.additions, deletions: t.prFiles.deletions })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId))
      .orderBy(asc(t.prFiles.path));
  }

  async listReviews(prId: string): Promise<SmartDiffReviewInput[]> {
    const rows = await reviewRepo.reviewsForPull(this.db, prId);
    return rows.map(({ review, findings }) => ({
      id: review.id,
      agentId: review.agentId,
      kind: review.kind,
      createdAt: review.createdAt,
      findings: findings.map((f) => ({ file: f.file, startLine: f.startLine })),
    }));
  }
}
