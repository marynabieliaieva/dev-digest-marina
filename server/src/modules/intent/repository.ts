import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { IntentConfidence, IntentSource, PromptSectionStat } from '@devdigest/shared';

/**
 * Intent data-access. Owns `pr_intent`; reads `pull_requests`/`repos`/`pr_files`
 * for derivation input. Returns plain DTO-shaped objects (never `$inferSelect`).
 */

export interface IntentPullInfo {
  id: string;
  number: number;
  title: string;
  body: string | null;
  headSha: string;
  repo: { owner: string; name: string };
}

export interface PrFileOutlineInput {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

/** A persisted `pr_intent` row as a plain object (`summary` maps the `intent` column). */
export interface IntentRow {
  prId: string;
  summary: string;
  inScope: string[];
  outOfScope: string[];
  riskAreas: string[];
  confidence: IntentConfidence;
  missingContext: string[];
  sources: IntentSource[];
  composition: PromptSectionStat[];
  status: 'ready' | 'failed';
  error: string | null;
  headSha: string | null;
  provider: string | null;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  derivedAt: Date;
}

export type IntentUpsert = Omit<IntentRow, 'prId' | 'derivedAt'>;

export class IntentRepository {
  constructor(private db: Db) {}

  /** The PR (with its repo owner/name) iff it belongs to `workspaceId`. */
  async getPullForWorkspace(workspaceId: string, prId: string): Promise<IntentPullInfo | undefined> {
    const [row] = await this.db
      .select({
        id: t.pullRequests.id,
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
      number: row.number,
      title: row.title,
      body: row.body,
      headSha: row.headSha,
      repo: { owner: row.owner, name: row.name },
    };
  }

  async listPrFileOutlineInputs(prId: string): Promise<PrFileOutlineInput[]> {
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

  async getIntent(prId: string): Promise<IntentRow | undefined> {
    const [row] = await this.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId)).limit(1);
    if (!row) return undefined;
    return {
      prId: row.prId,
      summary: row.intent,
      inScope: row.inScope,
      outOfScope: row.outOfScope,
      riskAreas: row.riskAreas,
      confidence: row.confidence,
      missingContext: row.missingContext,
      sources: row.sources,
      composition: row.composition,
      status: row.status,
      error: row.error,
      headSha: row.headSha,
      provider: row.provider,
      model: row.model,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      costUsd: row.costUsd,
      derivedAt: row.derivedAt,
    };
  }

  /** One row per PR: insert or overwrite. Returns the stored row. */
  async upsertIntent(prId: string, rec: IntentUpsert): Promise<IntentRow> {
    const values = {
      intent: rec.summary,
      inScope: rec.inScope,
      outOfScope: rec.outOfScope,
      riskAreas: rec.riskAreas,
      confidence: rec.confidence,
      missingContext: rec.missingContext,
      sources: rec.sources,
      composition: rec.composition,
      status: rec.status,
      error: rec.error,
      headSha: rec.headSha,
      provider: rec.provider,
      model: rec.model,
      tokensIn: rec.tokensIn,
      tokensOut: rec.tokensOut,
      costUsd: rec.costUsd,
      derivedAt: new Date(),
    };
    await this.db
      .insert(t.prIntent)
      .values({ prId, ...values })
      .onConflictDoUpdate({ target: t.prIntent.prId, set: values });
    const stored = await this.getIntent(prId);
    return stored!;
  }
}
