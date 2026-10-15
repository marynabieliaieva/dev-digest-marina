import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { tags } from '../../db/schema/tags.js';
import type { TagRepository } from './ports.js';
import type { NewTag, Tag } from './types.js';

export class DrizzleTagRepository implements TagRepository {
  constructor(private readonly db: Db) {}

  async listByRepo(repoId: string): Promise<Tag[]> {
    return this.db.select().from(tags).where(eq(tags.repoId, repoId)).orderBy(asc(tags.name));
  }

  async findByName(repoId: string, name: string): Promise<Tag | null> {
    const [row] = await this.db
      .select()
      .from(tags)
      .where(and(eq(tags.repoId, repoId), eq(tags.name, name)))
      .limit(1);
    return row ?? null;
  }

  async insert(input: NewTag): Promise<Tag> {
    const [row] = await this.db.insert(tags).values(input).returning();
    return row!;
  }

  async delete(repoId: string, tagId: string): Promise<boolean> {
    const rows = await this.db
      .delete(tags)
      .where(and(eq(tags.repoId, repoId), eq(tags.id, tagId)))
      .returning({ id: tags.id });
    return rows.length > 0;
  }
}
