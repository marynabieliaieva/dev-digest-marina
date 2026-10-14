import OpenAI from 'openai';
import type { Summary, SummaryRequest } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { SummaryRepository } from './repository.js';
import { SUMMARY_MODEL } from './constants.js';
import { summaryCacheKey, truncateDiff } from './helpers.js';

export class SummaryService {
  private readonly repo: SummaryRepository;

  constructor(private readonly container: Container) {
    this.repo = new SummaryRepository(container.db);
  }

  async summarize(userId: string, req: SummaryRequest, diff: string): Promise<Summary> {
    const key = summaryCacheKey(req.prId, req.maxWords);
    const cached = await this.repo.findByKey(key);
    if (cached) return cached;

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: SUMMARY_MODEL,
      messages: [
        { role: 'system', content: `Summarize this pull request diff in at most ${req.maxWords} words.` },
        { role: 'user', content: truncateDiff(diff) },
      ],
    });

    return this.repo.insert(userId, key, {
      prId: req.prId,
      text: completion.choices[0]?.message.content ?? '',
      model: SUMMARY_MODEL,
    });
  }
}
