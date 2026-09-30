import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SmartDiffRepository } from './repository.js';
import { SmartDiffService } from './service.js';

/**
 * Smart Diff module.
 *
 *   GET /pulls/:id/smart-diff → SmartDiffResponse (files grouped by role + finding lines)
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SmartDiffService(new SmartDiffRepository(app.container.db));

  app.get('/pulls/:id/smart-diff', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getSmartDiff(workspaceId, req.params.id);
  });
}
