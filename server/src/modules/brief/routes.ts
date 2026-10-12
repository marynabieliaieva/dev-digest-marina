import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PrBriefRequest, PrBriefResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefService } from './service.js';
import { pinoBriefLog } from './helpers.js';
import { BRIEF_RATE_LIMIT } from './constants.js';

/**
 * Brief module — the pre-review PR briefing.
 *
 *   GET  /pulls/:id/brief  → PrBriefResponse (DB only; brief: null when never generated)
 *   POST /pulls/:id/brief  → PrBriefResponse (generates; 409 while one is running,
 *                            502 brief_generation_failed when the model step fails)
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BriefService(app.container);

  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams, response: { 200: PrBriefResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.get(workspaceId, req.params.id);
    },
  );

  app.post(
    '/pulls/:id/brief',
    {
      schema: {
        params: IdParams,
        // A POST with no payload reaches validation as null/undefined: treat it as `{}` (mode refresh).
        body: z.preprocess((v) => v ?? {}, PrBriefRequest),
        response: { 200: PrBriefResponse },
      },
      config: { rateLimit: BRIEF_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.generate(workspaceId, req.params.id, req.body.mode, pinoBriefLog(req.log));
    },
  );
}
