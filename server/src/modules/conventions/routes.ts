import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConventionCategory, ConventionStatus, SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

/**
 * Conventions module — scan a cloned repo for house coding conventions, verify
 * every citation against the clone, and merge accepted candidates into one
 * skill.
 *
 *   POST  /repos/:id/conventions/extract        → 202 { extractionId } (enqueue)
 *   GET   /repos/:id/conventions                 → { extraction, candidates }
 *   PATCH /conventions/:id                       → accept / reject / edit
 *   POST  /repos/:id/conventions/skill-preview   → draft skill body; persists NOTHING
 *   POST  /repos/:id/conventions/skill           → create skill + stamp + optional agent link
 */

const UpdateConventionBody = z.object({
  status: ConventionStatus.optional(),
  rule: z.string().min(1).max(240).optional(),
  category: ConventionCategory.optional(),
});

const SkillPreviewBody = z.object({
  candidate_ids: z.array(z.string().uuid()).min(1),
});

const CreateSkillBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500),
  type: SkillType,
  body: z.string().min(1),
  enabled: z.boolean().default(true),
  candidate_ids: z.array(z.string().uuid()).min(1),
  agent_id: z.string().uuid().optional(),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);
  service.registerJobHandler();

  app.post('/repos/:id/conventions/extract', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const result = await service.extract(workspaceId, req.params.id);
    reply.status(202);
    return result;
  });

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.get(workspaceId, req.params.id);
  });

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: UpdateConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const candidate = await service.updateCandidate(workspaceId, req.params.id, req.body);
      if (!candidate) throw new NotFoundError('Convention not found');
      return candidate;
    },
  );

  app.post(
    '/repos/:id/conventions/skill-preview',
    { schema: { params: IdParams, body: SkillPreviewBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.skillPreview(workspaceId, req.params.id, req.body.candidate_ids);
    },
  );

  app.post(
    '/repos/:id/conventions/skill',
    { schema: { params: IdParams, body: CreateSkillBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const body = req.body;
      const skill = await service.createSkillFromConventions(workspaceId, {
        name: body.name,
        description: body.description,
        type: body.type,
        body: body.body,
        enabled: body.enabled,
        candidateIds: body.candidate_ids,
        ...(body.agent_id !== undefined ? { agentId: body.agent_id } : {}),
      });
      reply.status(201);
      return skill;
    },
  );
}
