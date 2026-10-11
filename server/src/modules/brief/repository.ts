import { and, asc, eq } from 'drizzle-orm';
import { PrBrief } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Brief data-access. Owns `pr_brief`; reads `pull_requests`/`repos`/`pr_files`
 * for generation input. Returns plain DTO-shaped objects.
 */

export interface BriefPullInfo {
  id: string;
  repoId: string;
  number: number;
  title: string;
  body: string | null;
  headSha: string;
  repo: { owner: string; name: string };
}

export interface BriefFileRow {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export class BriefRepository {
  constructor(private db: Db) {}

  /** The PR (with its repo owner/name) iff it belongs to `workspaceId`. */
  async getPullForWorkspace(workspaceId: string, prId: string): Promise<BriefPullInfo | undefined> {
    const [row] = await this.db
      .select({
        id: t.pullRequests.id,
        repoId: t.pullRequests.repoId,
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        body: t.pullRequests.body,
        headSha: t.pullRequests.headSha,
        owner: t.repos.owner,
        name: t.repos.name,
      })
      .from(t.pullRequests)
      .innerJoin(t.repos, eq(t.repos.id, t.pullRequests.repoId))
      .where(and(eq(t.pullRequests.id, prId), eq(t.pullRequests.workspaceId, workspaceId)))
      .limit(1);
    if (!row) return undefined;
    return {
      id: row.id,
      repoId: row.repoId,
      number: row.number,
      title: row.title,
      body: row.body,
      headSha: row.headSha,
      repo: { owner: row.owner, name: row.name },
    };
  }

  async listPrFiles(prId: string): Promise<BriefFileRow[]> {
    return this.db
      .select({
        path: t.prFiles.path,
        additions: t.prFiles.additions,
        deletions: t.prFiles.deletions,
        patch: t.prFiles.patch,
      })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId))
      .orderBy(asc(t.prFiles.path));
  }

  /** The stored brief; an invalid or legacy row is treated as absent. */
  async getBrief(prId: string): Promise<PrBrief | null> {
    const [row] = await this.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId)).limit(1);
    if (!row) return null;
    const parsed = PrBrief.safeParse(row.json);
    return parsed.success ? parsed.data : null;
  }

  async upsertBrief(prId: string, brief: PrBrief): Promise<void> {
    await this.db
      .insert(t.prBrief)
      .values({ prId, json: brief })
      .onConflictDoUpdate({ target: t.prBrief.prId, set: { json: brief } });
  }
}
