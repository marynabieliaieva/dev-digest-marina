import type { FastifyInstance } from 'fastify';
import { TicketService } from './service.js';

export async function ticketRoutes(app: FastifyInstance) {
  const service = new TicketService(app.container);

  app.get<{ Params: { id: string } }>('/tickets/:id', async (req, reply) => {
    const ticket = await service.get(req.params.id);
    if (!ticket) return reply.code(404).send({ error: 'not_found' });
    return ticket;
  });

  app.post<{ Params: { id: string } }>('/tickets/:id/close', async (req, reply) => {
    try {
      return await service.close(req.params.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      if (message === 'ticket_not_found') return reply.code(404).send({ error: message });
      if (message === 'ticket_already_closed') return reply.code(409).send({ error: message });
      throw err;
    }
  });
}
