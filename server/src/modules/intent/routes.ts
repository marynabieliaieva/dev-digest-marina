import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { IntentService } from './service.js';
import { pinoIntentLog } from './helpers.js';

/**
 * Intent module — the derived intent/scope of a PR.
 *
 *   GET  /pulls/:id/intent          → PrIntentResponse (intent: null when never derived)
 *   POST /pulls/:id/intent/derive   → PrIntentResponse (always re-derives; a failed
 *                                     derivation is a 200 with status:'failed')
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new IntentService(app.container);

  app.get('/pulls/:id/intent', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.get(workspaceId, req.params.id);
  });

  app.post(
    '/pulls/:id/intent/derive',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      await service.derive(workspaceId, req.params.id, { log: pinoIntentLog(req.log) });
      return service.get(workspaceId, req.params.id);
    },
  );
}
