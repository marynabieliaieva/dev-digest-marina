import { and, count, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema/index.js';
import { UNIQUE_VIOLATION } from './constants.js';

// Raw Drizzle row type stays local to this file; service maps it to the shared Tag.
export type TagRow = typeof t.tags.$inferSelect;

export class TagRepository {
  constructor(private db: Db) {}

  async listByRepo(repoId: string): Promise<TagRow[]> {
    return this.db.select().from(t.tags).where(eq(t.tags.repoId, repoId)).orderBy(t.tags.name);
  }

  async countByRepo(repoId: string): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(t.tags).where(eq(t.tags.repoId, repoId));
    return row?.n ?? 0;
  }

  /** Returns null when (repoId, name) already exists. */
  async insert(repoId: string, name: string, color: string): Promise<TagRow | null> {
    try {
      const [row] = await this.db.insert(t.tags).values({ repoId, name, color }).returning();
      return row ?? null;
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) return null;
      throw err;
    }
  }

  /** Returns true if a row was deleted. */
  async delete(repoId: string, tagId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.tags)
      .where(and(eq(t.tags.repoId, repoId), eq(t.tags.id, tagId)))
      .returning({ id: t.tags.id });
    return rows.length > 0;
  }
}
