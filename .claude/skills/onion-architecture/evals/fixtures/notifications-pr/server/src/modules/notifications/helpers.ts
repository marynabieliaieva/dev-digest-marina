import type { Notification } from '@devdigest/shared';
import type { NotificationRow } from './repository.js';

export function toNotificationDto(row: NotificationRow): Notification {
  return {
    id: row.id,
    userId: row.userId,
    channel: row.channel,
    title: row.title,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
