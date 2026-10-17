import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CreateTagInputSchema } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { TagService } from './service.js';

const RepoParams = z.object({ repoId: z.string().uuid() });
const TagParams = RepoParams.extend({ tagId: z.string().uuid() });

export async function tagRoutes(app: FastifyInstance, container: Container) {
  const service = new TagService(container);

  app.get('/repos/:repoId/tags', async (req) => {
    const { repoId } = RepoParams.parse(req.params);
    return service.list(repoId);
  });

  app.post('/repos/:repoId/tags', async (req, reply) => {
    const { repoId } = RepoParams.parse(req.params);
    const input = CreateTagInputSchema.parse(req.body);
    const tag = await service.create(repoId, input);
    return reply.code(201).send(tag);
  });

  app.delete('/repos/:repoId/tags/:tagId', async (req, reply) => {
    const { repoId, tagId } = TagParams.parse(req.params);
    await service.delete(repoId, tagId);
    return reply.code(204).send();
  });
}
