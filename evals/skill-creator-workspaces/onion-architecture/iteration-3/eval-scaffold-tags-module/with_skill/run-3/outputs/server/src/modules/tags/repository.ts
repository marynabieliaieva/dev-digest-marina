import { and, eq } from 'drizzle-orm';
import type { Tag } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import { tags } from '../../db/schema/tags.js';
import { toTagDto } from './helpers.js';

// Raw Drizzle row type stays local to the repository/helpers seam.
export type TagRow = typeof tags.$inferSelect;

export class TagRepository {
  constructor(private db: Db) {}

  async listByRepo(repoId: string): Promise<Tag[]> {
    const rows = await this.db.select().from(tags).where(eq(tags.repoId, repoId));
    return rows.map(toTagDto);
  }

  async findByName(repoId: string, name: string): Promise<Tag | null> {
    const [row] = await this.db
      .select()
      .from(tags)
      .where(and(eq(tags.repoId, repoId), eq(tags.name, name)));
    return row ? toTagDto(row) : null;
  }

  async create(repoId: string, input: { name: string; color: string }): Promise<Tag> {
    const [row] = await this.db.insert(tags).values({ repoId, ...input }).returning();
    return toTagDto(row);
  }

  async delete(repoId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(tags)
      .where(and(eq(tags.repoId, repoId), eq(tags.id, id)))
      .returning({ id: tags.id });
    return rows.length > 0;
  }
}
