import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema/labels.js';
import type { Label } from '@devdigest/shared';

type LabelRow = typeof t.labels.$inferSelect;

const toLabel = (row: LabelRow): Label => ({
  id: row.id,
  repoId: row.repoId,
  name: row.name,
  color: row.color,
});

export class LabelRepository {
  constructor(private readonly db: Db) {}

  async listByRepo(repoId: string): Promise<Label[]> {
    const rows = await this.db.select().from(t.labels).where(eq(t.labels.repoId, repoId));
    return rows.map(toLabel);
  }

  async countByRepo(repoId: string): Promise<number> {
    return (await this.listByRepo(repoId)).length;
  }

  async insert(repoId: string, name: string, color: string): Promise<Label> {
    const [row] = await this.db.insert(t.labels).values({ repoId, name, color }).returning();
    return toLabel(row);
  }

  async remove(repoId: string, id: string): Promise<void> {
    await this.db.delete(t.labels).where(and(eq(t.labels.repoId, repoId), eq(t.labels.id, id)));
  }
}
