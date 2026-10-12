import type { FastifyInstance } from 'fastify';
import { CreateInvoiceBody } from '@devdigest/shared';
import { InvoiceService } from './service.js';

export async function invoiceRoutes(app: FastifyInstance) {
  const service = new InvoiceService(app.container);

  app.post('/invoices', async (req, reply) => {
    const body = CreateInvoiceBody.parse(req.body);
    const invoice = await service.create({
      customerEmail: body.customerEmail,
      amountCents: body.amountCents,
      currency: body.currency,
      dueDate: new Date(body.dueDate),
    });
    return reply.code(201).send(invoice);
  });

  app.post<{ Params: { id: string } }>('/invoices/:id/paid', async (req, reply) => {
    const invoice = await service.markPaid(req.params.id);
    return invoice ? invoice : reply.code(404).send({ error: 'not_found' });
  });
}
