import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../../platform/errors.js';
import type { TagService } from './service.js';
import { createTagSchema } from './types.js';

const repoParams = z.object({ repoId: z.string().uuid() });
const tagParams = repoParams.extend({ tagId: z.string().uuid() });

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new ValidationError(r.error.message);
  return r.data;
}

export function registerTagRoutes(app: FastifyInstance, service: TagService) {
  app.get('/repos/:repoId/tags', async (req) => {
    const { repoId } = parse(repoParams, req.params);
    return service.list(repoId);
  });

  app.post('/repos/:repoId/tags', async (req, reply) => {
    const { repoId } = parse(repoParams, req.params);
    const body = parse(createTagSchema, req.body);
    const tag = await service.create(repoId, body);
    return reply.code(201).send(tag);
  });

  app.delete('/repos/:repoId/tags/:tagId', async (req, reply) => {
    const { repoId, tagId } = parse(tagParams, req.params);
    await service.delete(repoId, tagId);
    return reply.code(204).send();
  });
}
