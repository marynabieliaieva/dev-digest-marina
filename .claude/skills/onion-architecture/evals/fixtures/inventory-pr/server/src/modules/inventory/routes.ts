import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { InventoryService } from './service.js';
import { withSupplierNames } from './serializers.js';

const RestockBody = z.object({ amount: z.number().int() });

export async function inventoryRoutes(app: FastifyInstance) {
  const service = new InventoryService(app.container);

  app.get('/inventory', async () => withSupplierNames(await service.list()));

  app.post<{ Params: { id: string } }>('/inventory/:id/restock', async (req) => {
    const body = RestockBody.parse(req.body);
    return service.restock(req.params.id, body.amount);
  });
}
