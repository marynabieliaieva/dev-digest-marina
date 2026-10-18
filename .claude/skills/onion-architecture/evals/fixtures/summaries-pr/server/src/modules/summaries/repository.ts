import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema/summaries.js';
import type { Summary } from '@devdigest/shared';

export class SummaryRepository {
  constructor(private readonly db: Db) {}

  async findByKey(cacheKey: string): Promise<Summary | null> {
    const [row] = await this.db.select().from(t.summaries).where(eq(t.summaries.cacheKey, cacheKey));
    return row
      ? { id: row.id, prId: row.prId, text: row.text, model: row.model, createdAt: row.createdAt.toISOString() }
      : null;
  }

  async countSince(userId: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(t.summaries)
      .where(and(eq(t.summaries.userId, userId), gte(t.summaries.createdAt, since)));
    return Number(row?.n ?? 0);
  }

  async insert(userId: string, cacheKey: string, s: Omit<Summary, 'id' | 'createdAt'>): Promise<Summary> {
    const [row] = await this.db
      .insert(t.summaries)
      .values({ userId, cacheKey, prId: s.prId, text: s.text, model: s.model })
      .returning();
    return { id: row.id, prId: row.prId, text: row.text, model: row.model, createdAt: row.createdAt.toISOString() };
  }
}
