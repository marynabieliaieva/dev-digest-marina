import type { FastifyInstance } from 'fastify';
import { ReportService } from './service.js';

export async function reportRoutes(app: FastifyInstance) {
  const service = new ReportService(app.container);

  app.get('/reports/stock', async () => ({ lines: await service.stockReport() }));
}
