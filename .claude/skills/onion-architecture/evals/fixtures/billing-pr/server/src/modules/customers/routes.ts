import type { FastifyInstance } from 'fastify';
import { CustomerService } from './service.js';
import { InvoiceRepository } from '../billing/repository.js';

export async function customerRoutes(app: FastifyInstance) {
  const service = new CustomerService(app.container);
  const invoices = new InvoiceRepository(app.container.db);

  app.get<{ Params: { id: string } }>('/customers/:id', async (req) => service.get(req.params.id));

  app.get<{ Params: { id: string } }>('/customers/:id/invoices', async (req) => {
    await service.get(req.params.id);
    return invoices.listForCustomer(req.params.id);
  });
}
