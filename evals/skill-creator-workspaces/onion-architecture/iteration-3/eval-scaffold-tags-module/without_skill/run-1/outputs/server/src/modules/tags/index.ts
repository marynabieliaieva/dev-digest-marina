import type { FastifyInstance } from 'fastify';
import type { Container } from '../../platform/container.js';
import { DrizzleTagRepository } from './repository.js';
import { registerTagRoutes } from './routes.js';
import { TagService } from './service.js';

/** Composition root for the module: call from app bootstrap with the container. */
export function registerTags(app: FastifyInstance, container: Container) {
  registerTagRoutes(app, new TagService(new DrizzleTagRepository(container.db)));
}
