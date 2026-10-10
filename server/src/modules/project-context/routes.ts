import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ContextPaths } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ProjectContextService } from './service.js';

/**
 * Project-context module — repo documents plus agent/skill attachments.
 *
 *   GET      /repos/:id/context              → { roots, docs } (rescans the clone every time)
 *   GET      /repos/:id/context/file?path=   → { path, content, size, est_tokens }
 *   GET|PUT  /agents/:id/context             → { paths, inherited } / body { paths }
 *   GET|PUT  /skills/:id/context             → { paths } / body { paths }
 *
 * Errors: 400 invalid_path, 404 not_found, 409 context_unavailable.
 */

const FileQuery = z.object({ path: z.string() });

export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ProjectContextService(app.container);

  app.get('/repos/:id/context', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listDocs(workspaceId, req.params.id);
  });

  app.get(
    '/repos/:id/context/file',
    { schema: { params: IdParams, querystring: FileQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getDoc(workspaceId, req.params.id, req.query.path);
    },
  );

  app.get('/agents/:id/context', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getAgentContext(workspaceId, req.params.id);
  });

  app.put(
    '/agents/:id/context',
    { schema: { params: IdParams, body: ContextPaths } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.setAgentContext(workspaceId, req.params.id, req.body.paths);
    },
  );

  app.get('/skills/:id/context', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getSkillContext(workspaceId, req.params.id);
  });

  app.put(
    '/skills/:id/context',
    { schema: { params: IdParams, body: ContextPaths } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.setSkillContext(workspaceId, req.params.id, req.body.paths);
    },
  );
}
