import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { EvalService } from './service.js';

/**
 * eval module — turn decided findings into eval cases, run an agent's set in
 * the background, read batches / dashboards / compare.
 *   POST   /findings/:id/eval-case          → 201 EvalCaseDto
 *   GET    /agents/:id/eval-cases           → EvalCaseDto[] (newest first)
 *   GET    /eval-cases/:id                  → EvalCaseDto (with input_diff / input_meta)
 *   DELETE /eval-cases/:id                  → 204
 *   POST   /agents/:id/eval-runs            → 202 { batch_id }
 *   POST   /eval-cases/:id/run              → 202 { batch_id }
 *   GET    /agents/:id/eval-runs            → EvalBatch[] (scope set, newest first, max 50)
 *   GET    /eval-runs/compare?base=&head=   → EvalCompare
 *   POST   /eval-runs/all                   → 202 { started, skipped }
 *   GET    /eval-runs/:batchId              → EvalBatchDetail
 *   GET    /agents/:id/eval-dashboard       → EvalDashboard
 *   GET    /eval-dashboard                  → EvalWorkspaceDashboard
 */
const BatchParams = z.object({ batchId: z.string().uuid() });
const CompareQuery = z.object({ base: z.string().uuid(), head: z.string().uuid() });

/** Each run-starting POST can fan out to many LLM calls — same tight limit as reviews. */
const RUN_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new EvalService(app.container, app.log);

  // ---- cases ---------------------------------------------------------------

  app.post('/findings/:id/eval-case', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const created = await service.createCase(workspaceId, req.params.id);
    reply.status(201);
    return created;
  });

  app.get('/agents/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listCases(workspaceId, req.params.id);
  });

  app.get('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getCase(workspaceId, req.params.id);
  });

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.deleteCase(workspaceId, req.params.id);
    reply.status(204);
    return reply.send();
  });

  // ---- starting runs (202, executed in the background) -----------------------

  app.post(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams }, config: { rateLimit: RUN_RATE_LIMIT } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const started = await service.startAgentRun(workspaceId, req.params.id);
      reply.status(202);
      return started;
    },
  );

  app.post(
    '/eval-cases/:id/run',
    { schema: { params: IdParams }, config: { rateLimit: RUN_RATE_LIMIT } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const started = await service.startCaseRun(workspaceId, req.params.id);
      reply.status(202);
      return started;
    },
  );

  // Static segments (`compare`, `all`) are registered before `/eval-runs/:batchId`.
  app.post('/eval-runs/all', { config: { rateLimit: RUN_RATE_LIMIT } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const result = await service.runAll(workspaceId);
    reply.status(202);
    return result;
  });

  app.get('/eval-runs/compare', { schema: { querystring: CompareQuery } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.compare(workspaceId, req.query.base, req.query.head);
  });

  // ---- reads ------------------------------------------------------------------

  app.get('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listBatches(workspaceId, req.params.id);
  });

  app.get('/eval-runs/:batchId', { schema: { params: BatchParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getBatch(workspaceId, req.params.batchId);
  });

  app.get('/agents/:id/eval-dashboard', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.agentDashboard(workspaceId, req.params.id);
  });

  app.get('/eval-dashboard', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.workspaceDashboard(workspaceId);
  });
}
