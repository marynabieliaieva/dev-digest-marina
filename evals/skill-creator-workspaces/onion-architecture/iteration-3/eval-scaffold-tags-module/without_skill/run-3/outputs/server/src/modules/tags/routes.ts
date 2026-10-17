import type { FastifyInstance } from 'fastify';
import type { Container } from '../../platform/container.js';
import { ValidationError } from '../../platform/errors.js';
import { DrizzleTagRepository } from './repository.js';
import { createTagBody, repoParams, tagParams } from './schemas.js';
import { TagService } from './service.js';

function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { message: string } } }, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) throw new ValidationError(r.error.message);
  return r.data;
}

export async function tagRoutes(app: FastifyInstance, container: Container) {
  const service = new TagService(new DrizzleTagRepository(container.db));

  app.get('/repos/:repoId/tags', async (req) => {
    const { repoId } = parse(repoParams, req.params);
    return service.list(repoId);
  });

  app.post('/repos/:repoId/tags', async (req, reply) => {
    const { repoId } = parse(repoParams, req.params);
    const body = parse(createTagBody, req.body);
    const tag = await service.create({ repoId, ...body });
    return reply.code(201).send(tag);
  });

  app.delete('/repos/:repoId/tags/:tagId', async (req, reply) => {
    const { repoId, tagId } = parse(tagParams, req.params);
    await service.delete(repoId, tagId);
    return reply.code(204).send();
  });
}
