import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TicketService } from './service.js';

const AssignBody = z.object({ assignee: z.string().min(1) });

export async function ticketRoutes(app: FastifyInstance) {
  const service = new TicketService(app.container);

  app.get<{ Params: { id: string } }>('/tickets/:id', async (req) => service.get(req.params.id));

  app.post<{ Params: { id: string }; Body: { assignee: string } }>('/tickets/:id/assign', async (req) => {
    const { assignee } = AssignBody.parse(req.body);
    return service.assign(req.params.id, assignee);
  });
}
