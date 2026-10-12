import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema/notifications.js';

export type NotificationRow = typeof t.notifications.$inferSelect;

export class NotificationRepository {
  constructor(private readonly db: Db) {}

  async listForUser(userId: string, limit: number): Promise<NotificationRow[]> {
    return this.db
      .select()
      .from(t.notifications)
      .where(eq(t.notifications.userId, userId))
      .orderBy(desc(t.notifications.createdAt))
      .limit(limit);
  }

  async markRead(userId: string, id: string): Promise<void> {
    await this.db
      .update(t.notifications)
      .set({ readAt: new Date() })
      .where(and(eq(t.notifications.id, id), eq(t.notifications.userId, userId)));
  }
}
