import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OrderService } from './service.js';

const PlaceOrderBody = z.object({
  customerId: z.string(),
  itemCount: z.number().int(),
  totalCents: z.number().int(),
});

export async function orderRoutes(app: FastifyInstance) {
  const service = new OrderService(app.container);

  app.post('/orders', async (req, reply) => {
    const body = PlaceOrderBody.parse(req.body);
    const order = await service.place(body.customerId, body.itemCount, body.totalCents);
    return reply.code(201).send(order);
  });

  app.post<{ Params: { id: string } }>('/orders/:id/cancel', async (req) =>
    service.cancel(req.params.id),
  );
}
