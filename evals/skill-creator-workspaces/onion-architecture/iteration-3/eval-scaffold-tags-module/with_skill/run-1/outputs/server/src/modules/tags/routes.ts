import type { FastifyInstance } from 'fastify';
import { CreateTagInput, TagIdParams, TagParams } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { TagService } from './service.js';

export async function tagRoutes(app: FastifyInstance, container: Container) {
  const service = new TagService(container);

  app.get('/repos/:repoId/tags', async (req) => {
    const { repoId } = TagParams.parse(req.params);
    return service.list(repoId);
  });

  app.post('/repos/:repoId/tags', async (req, reply) => {
    const { repoId } = TagParams.parse(req.params);
    const input = CreateTagInput.parse(req.body);
    const tag = await service.create(repoId, input);
    return reply.code(201).send(tag);
  });

  app.delete('/repos/:repoId/tags/:tagId', async (req, reply) => {
    const { repoId, tagId } = TagIdParams.parse(req.params);
    await service.delete(repoId, tagId);
    return reply.code(204).send();
  });
}
