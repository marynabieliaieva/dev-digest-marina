import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema/digests.js';
import type { Digest } from '@devdigest/shared';

type DigestRow = typeof t.digests.$inferSelect;

const toDigest = (row: DigestRow): Digest => ({
  id: row.id,
  repoId: row.repoId,
  body: row.body,
  createdAt: row.createdAt.toISOString(),
});

export class DigestRepository {
  constructor(private readonly db: Db) {}

  async insert(repoId: string, body: string): Promise<Digest> {
    const [row] = await this.db.insert(t.digests).values({ repoId, body }).returning();
    return toDigest(row);
  }

  async latest(repoId: string): Promise<Digest | null> {
    const [row] = await this.db
      .select()
      .from(t.digests)
      .where(eq(t.digests.repoId, repoId))
      .orderBy(desc(t.digests.createdAt))
      .limit(1);
    return row ? toDigest(row) : null;
  }
}
