import type { FastifyInstance } from 'fastify';
import { TicketService } from './service.js';

export async function ticketRoutes(app: FastifyInstance) {
  const service = new TicketService(app.container);

  app.get<{ Params: { id: string } }>('/tickets/:id', async (req) => service.get(req.params.id));
}
