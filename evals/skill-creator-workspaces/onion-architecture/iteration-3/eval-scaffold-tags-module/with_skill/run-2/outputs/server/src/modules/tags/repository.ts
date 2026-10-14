import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { tags } from '../../db/schema/tags.js';

// Raw row type stays local to this file; service maps it to the shared `Tag`.
export type TagRow = typeof tags.$inferSelect;

export class TagRepository {
  constructor(private db: Db) {}

  async listByRepo(repoId: string): Promise<TagRow[]> {
    return this.db.select().from(tags).where(eq(tags.repoId, repoId)).orderBy(asc(tags.name));
  }

  async findByName(repoId: string, name: string): Promise<TagRow | undefined> {
    const [row] = await this.db
      .select()
      .from(tags)
      .where(and(eq(tags.repoId, repoId), eq(tags.name, name)))
      .limit(1);
    return row;
  }

  async create(input: { repoId: string; name: string; color: string }): Promise<TagRow> {
    const [row] = await this.db.insert(tags).values(input).returning();
    return row!;
  }

  /** Returns true if a row was deleted. */
  async delete(repoId: string, tagId: string): Promise<boolean> {
    const rows = await this.db
      .delete(tags)
      .where(and(eq(tags.repoId, repoId), eq(tags.id, tagId)))
      .returning({ id: tags.id });
    return rows.length > 0;
  }
}
