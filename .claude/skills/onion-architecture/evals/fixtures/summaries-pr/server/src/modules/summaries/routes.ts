import type { FastifyInstance } from 'fastify';
import { SummaryRequest } from '@devdigest/shared';
import { SummaryService } from './service.js';
import { SummaryRepository } from './repository.js';
import { FREE_TIER_DAILY_LIMIT } from './constants.js';

export async function summaryRoutes(app: FastifyInstance) {
  const service = new SummaryService(app.container);
  const repo = new SummaryRepository(app.container.db);

  app.post('/summaries', async (req, reply) => {
    const body = SummaryRequest.parse(req.body);
    const userId = req.user.id;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const used = await repo.countSince(userId, startOfDay);
    if (req.user.plan === 'free' && used >= FREE_TIER_DAILY_LIMIT) {
      return reply.code(429).send({ error: 'daily_limit_reached' });
    }

    const diff = await app.container.github.getPullRequestDiff(body.prId);
    if (!diff.trim()) {
      return reply.code(422).send({ error: 'empty_diff' });
    }

    return service.summarize(userId, body, diff);
  });
}
