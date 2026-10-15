import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CreateTagInput } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { TagService } from './service.js';

const RepoParams = z.object({ repoId: z.string().uuid() });
const TagParams = RepoParams.extend({ tagId: z.string().uuid() });

export async function tagRoutes(app: FastifyInstance, opts: { container: Container }) {
  const service = new TagService(opts.container);

  app.get('/repos/:repoId/tags', async (req) => {
    const { repoId } = RepoParams.parse(req.params);
    return service.list(repoId);
  });

  app.post('/repos/:repoId/tags', async (req, reply) => {
    const { repoId } = RepoParams.parse(req.params);
    const body = CreateTagInput.parse(req.body);
    return reply.code(201).send(await service.create(repoId, body));
  });

  app.delete('/repos/:repoId/tags/:tagId', async (req, reply) => {
    const { repoId, tagId } = TagParams.parse(req.params);
    await service.delete(repoId, tagId);
    return reply.code(204).send();
  });
}
