import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { MultiAgentService } from './service.js';
import { parseStartRequest } from './helpers.js';
import { MULTI_AGENT_RATE_LIMIT } from './constants.js';

/**
 * Multi-agent module — fan one PR out to several agents and compare them.
 *
 *   POST /pulls/:id/multi-agent-run  → MultiAgentRun (201; 400 bad body, 404, 409 agents_already_running, 422 disabled)
 *   GET  /pulls/:id/multi-agent      → MultiAgentRun (404 no_multi_agent_run)
 *   GET  /agents/run-estimates       → AgentRunEstimate[]
 */
export default async function multiAgentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new MultiAgentService(app.container);

  app.post(
    '/pulls/:id/multi-agent-run',
    // Body parsed by hand: a zod-provider body failure maps to 422 in the global handler, the contract wants 400.
    { schema: { params: IdParams }, config: { rateLimit: MULTI_AGENT_RATE_LIMIT } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const { agentIds } = parseStartRequest(req.body);
      const result = await service.start(workspaceId, req.params.id, agentIds, req.log);
      return reply.code(201).send(result);
    },
  );

  app.get('/pulls/:id/multi-agent', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.latestForPull(workspaceId, req.params.id);
  });

  // Static segment: find-my-way matches it before the param route `/agents/:id`, whatever the
  // registration order. It lives here (not in the agents module) to keep that module untouched.
  app.get('/agents/run-estimates', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.estimates(workspaceId);
  });
}
