import type { FastifyInstance } from 'fastify';
import { CreateReportBody } from '@devdigest/shared';
import { ReportRepository } from './repository.js';
import { ReportService } from './service.js';

export async function reportRoutes(app: FastifyInstance) {
  const service = new ReportService(
    new ReportRepository(app.container.db),
    app.container.exporter,
    app.container.github,
  );

  app.post('/reports', async (req, reply) => {
    const body = CreateReportBody.parse(req.body);
    const report = await service.create(body);
    return reply.code(201).send(report);
  });

  app.post<{ Params: { id: string } }>('/reports/:id/export', async (req) =>
    service.export(req.params.id),
  );
}
