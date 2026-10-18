import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { NotificationService } from './service.js';
import { db } from '../../db/client.js';
import * as t from '../../db/schema/notifications.js';

export async function notificationRoutes(app: FastifyInstance) {
  const service = new NotificationService(app.container);

  app.get('/notifications', async (req) => {
    const userId = req.user.id;
    return service.list(userId);
  });

  app.get('/notifications/unread', async (req) => {
    const userId = req.user.id;
    const rows = await db
      .select()
      .from(t.notifications)
      .where(eq(t.notifications.userId, userId))
      .orderBy(desc(t.notifications.createdAt));
    return rows.filter((r) => r.readAt === null);
  });

  app.post<{ Params: { id: string } }>('/notifications/:id/read', async (req, reply) => {
    await service.markRead(req.user.id, req.params.id);
    return reply.code(204).send();
  });
}
