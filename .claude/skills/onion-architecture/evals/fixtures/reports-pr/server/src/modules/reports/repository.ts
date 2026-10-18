import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema/reports.js';
import type { Report, ReportFormat } from '@devdigest/shared';

type ReportRow = typeof t.reports.$inferSelect;

const toReport = (row: ReportRow): Report => ({
  id: row.id,
  repoId: row.repoId,
  title: row.title,
  format: row.format as ReportFormat,
  exportedUrl: row.exportedUrl,
  createdAt: row.createdAt.toISOString(),
});

export class ReportRepository {
  constructor(private readonly db: Db) {}

  async get(id: string): Promise<Report | null> {
    const [row] = await this.db.select().from(t.reports).where(eq(t.reports.id, id));
    return row ? toReport(row) : null;
  }

  async insert(repoId: string, title: string, format: ReportFormat): Promise<Report> {
    const [row] = await this.db.insert(t.reports).values({ repoId, title, format }).returning();
    return toReport(row);
  }

  async setExportedUrl(id: string, url: string): Promise<Report | null> {
    const [row] = await this.db
      .update(t.reports)
      .set({ exportedUrl: url })
      .where(eq(t.reports.id, id))
      .returning();
    return row ? toReport(row) : null;
  }
}
