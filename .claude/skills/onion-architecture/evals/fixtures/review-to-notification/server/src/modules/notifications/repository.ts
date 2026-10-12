import type { Db } from '../../db/client.js';
import * as t from '../../db/schema/notifications.js';

export class NotificationRepository {
  constructor(private readonly db: Db) {}

  async insert(channel: string, title: string): Promise<void> {
    await this.db.insert(t.notifications).values({ channel, title });
  }
}
