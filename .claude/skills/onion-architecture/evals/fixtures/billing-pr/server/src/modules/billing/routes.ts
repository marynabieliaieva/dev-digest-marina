import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BillingService } from './service.js';

const CreateInvoiceBody = z.object({
  customerId: z.string(),
  lineItemCount: z.number().int(),
  amountCents: z.number().int().positive(),
});

export async function billingRoutes(app: FastifyInstance) {
  const service = new BillingService(app.container);

  app.post('/invoices', async (req, reply) => {
    const body = CreateInvoiceBody.parse(req.body);
    const invoice = await service.create(body.customerId, body.lineItemCount, body.amountCents);
    return reply.code(201).send(invoice);
  });

  app.get<{ Params: { customerId: string } }>('/customers/:customerId/outstanding', async (req) => ({
    amountCents: await service.totalOutstanding(req.params.customerId),
  }));
}
