import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/** Blast data-access — read-only over `pull_requests` and `pr_files`. */
export class BlastRepository {
  constructor(private db: Db) {}

  /** The PR's id + repoId, only if it belongs to `workspaceId`. */
  async findPull(workspaceId: string, prId: string): Promise<{ id: string; repoId: string } | null> {
    const [row] = await this.db
      .select({ id: t.pullRequests.id, repoId: t.pullRequests.repoId })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.id, prId), eq(t.pullRequests.workspaceId, workspaceId)))
      .limit(1);
    return row ?? null;
  }

  async listChangedPaths(prId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.prFiles.path })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId))
      .orderBy(asc(t.prFiles.path));
    return rows.map((r) => r.path);
  }
}
