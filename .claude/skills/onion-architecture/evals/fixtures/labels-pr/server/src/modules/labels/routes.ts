import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LabelService } from './service.js';

const CreateLabelBody = z.object({ name: z.string(), color: z.string() });

export async function labelRoutes(app: FastifyInstance) {
  const service = new LabelService(app.container);

  app.get<{ Params: { repoId: string } }>('/repos/:repoId/labels', async (req) =>
    service.list(req.params.repoId),
  );

  app.post<{ Params: { repoId: string } }>('/repos/:repoId/labels', async (req, reply) => {
    const body = CreateLabelBody.parse(req.body);
    const label = await service.create(req.params.repoId, body.name, body.color);
    return reply.code(201).send(label);
  });

  app.delete<{ Params: { repoId: string; id: string } }>('/repos/:repoId/labels/:id', async (req, reply) => {
    await service.remove(req.params.repoId, req.params.id);
    return reply.code(204).send();
  });
}
