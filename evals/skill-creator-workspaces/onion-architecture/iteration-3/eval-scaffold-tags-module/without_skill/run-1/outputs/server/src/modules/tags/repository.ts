import { and, eq, asc } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { tags } from '../../db/schema/tags.js';
import type { CreateTagInput, Tag } from './types.js';

/** Port: the service depends on this, never on Drizzle directly. */
export interface TagRepository {
  listByRepo(repoId: string): Promise<Tag[]>;
  findByName(repoId: string, name: string): Promise<Tag | null>;
  create(repoId: string, input: CreateTagInput): Promise<Tag>;
  delete(repoId: string, tagId: string): Promise<boolean>;
}

export class DrizzleTagRepository implements TagRepository {
  constructor(private readonly db: Db) {}

  listByRepo(repoId: string): Promise<Tag[]> {
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

  async create(repoId: string, input: CreateTagInput): Promise<Tag> {
    const [row] = await this.db
      .insert(tags)
      .values({ repoId, name: input.name, color: input.color })
      .returning();
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
