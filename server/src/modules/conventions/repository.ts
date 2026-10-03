import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionCategory, ConventionStatus, Provider } from '@devdigest/shared';
import type { ConventionExtractionRow, ConventionRow } from '../../db/rows.js';
export type { ConventionExtractionRow, ConventionRow };

/**
 * Conventions data-access. Owns `conventions` and `convention_extractions`.
 * Workspace-scoped on every read and write, per root CLAUDE.md tenancy rule.
 */

export interface RepoBasics {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  clonePath: string | null;
}

export interface FinishExtractionPatch {
  status: 'done' | 'failed';
  sampledFiles: number;
  candidatesRaw: number;
  candidatesKept: number;
  error?: string | null;
}

export interface InsertConvention {
  workspaceId: string;
  repoId: string;
  extractionId: string;
  category: ConventionCategory;
  rule: string;
  evidencePath: string;
  evidenceLine: number;
  evidenceSnippet: string;
  confidence: number;
}

export interface UpdateConventionPatch {
  status?: ConventionStatus;
  rule?: string;
  category?: ConventionCategory;
  edited?: boolean;
  skillId?: string | null;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  async getRepoBasics(workspaceId: string, repoId: string): Promise<RepoBasics | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        owner: t.repos.owner,
        name: t.repos.name,
        fullName: t.repos.fullName,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  async createExtraction(
    workspaceId: string,
    repoId: string,
    model: { provider: Provider; model: string },
  ): Promise<ConventionExtractionRow> {
    const [row] = await this.db
      .insert(t.conventionExtractions)
      .values({
        workspaceId,
        repoId,
        status: 'running',
        provider: model.provider,
        model: model.model,
      })
      .returning();
    return row!;
  }

  async getExtractionById(id: string): Promise<ConventionExtractionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventionExtractions)
      .where(eq(t.conventionExtractions.id, id));
    return row;
  }

  async finishExtraction(id: string, patch: FinishExtractionPatch): Promise<void> {
    await this.db
      .update(t.conventionExtractions)
      .set({
        status: patch.status,
        sampledFiles: patch.sampledFiles,
        candidatesRaw: patch.candidatesRaw,
        candidatesKept: patch.candidatesKept,
        error: patch.error ?? null,
        finishedAt: new Date(),
      })
      .where(eq(t.conventionExtractions.id, id));
  }

  /** The most recent extraction for a repo, or undefined if none has run yet. */
  async getLatestExtraction(
    workspaceId: string,
    repoId: string,
  ): Promise<ConventionExtractionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventionExtractions)
      .where(
        and(
          eq(t.conventionExtractions.workspaceId, workspaceId),
          eq(t.conventionExtractions.repoId, repoId),
        ),
      )
      .orderBy(desc(t.conventionExtractions.createdAt))
      .limit(1);
    return row;
  }

  async insertCandidates(rows: InsertConvention[]): Promise<ConventionRow[]> {
    if (rows.length === 0) return [];
    return this.db
      .insert(t.conventions)
      .values(
        rows.map((r) => ({
          workspaceId: r.workspaceId,
          repoId: r.repoId,
          extractionId: r.extractionId,
          category: r.category,
          rule: r.rule,
          evidencePath: r.evidencePath,
          evidenceLine: r.evidenceLine,
          evidenceSnippet: r.evidenceSnippet,
          confidence: r.confidence,
          status: 'pending' as const,
        })),
      )
      .returning();
  }

  async listCandidates(workspaceId: string, extractionId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.extractionId, extractionId)),
      )
      .orderBy(desc(t.conventions.confidence));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  async getByIds(workspaceId: string, ids: string[]): Promise<ConventionRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), inArray(t.conventions.id, ids)));
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateConventionPatch,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.edited !== undefined ? { edited: patch.edited } : {}),
        ...(patch.skillId !== undefined ? { skillId: patch.skillId } : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  async stampSkillId(workspaceId: string, ids: string[], skillId: string): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(t.conventions)
      .set({ skillId })
      .where(and(eq(t.conventions.workspaceId, workspaceId), inArray(t.conventions.id, ids)));
  }
}
