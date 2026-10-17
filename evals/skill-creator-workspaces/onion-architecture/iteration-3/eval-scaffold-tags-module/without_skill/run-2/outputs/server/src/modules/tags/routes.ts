import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../../platform/container.js';
import { TAG_COLOR_PATTERN, TAG_NAME_MAX_LENGTH } from './constants.js';

const repoParams = z.object({ repoId: z.string().uuid() });
const tagParams = z.object({ repoId: z.string().uuid(), tagId: z.string().uuid() });
const createBody = z.object({
  name: z.string().trim().min(1).max(TAG_NAME_MAX_LENGTH),
  color: z.string().regex(TAG_COLOR_PATTERN),
});

export async function tagRoutes(app: FastifyInstance, opts: { container: Container }) {
  const service = opts.container.tags;

  app.get('/repos/:repoId/tags', async (req) => {
    const { repoId } = repoParams.parse(req.params);
    return service.list(repoId);
  });

  app.post('/repos/:repoId/tags', async (req, reply) => {
    const { repoId } = repoParams.parse(req.params);
    const body = createBody.parse(req.body);
    const tag = await service.create({ repoId, ...body });
    return reply.code(201).send(tag);
  });

  app.delete('/repos/:repoId/tags/:tagId', async (req, reply) => {
    const { repoId, tagId } = tagParams.parse(req.params);
    await service.delete(repoId, tagId);
    return reply.code(204).send();
  });
}
