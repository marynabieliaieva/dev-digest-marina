import type { PullRequestRef } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ReviewRepository } from './repository.js';

export class ReviewService {
  private readonly repo: ReviewRepository;

  constructor(private readonly container: Container) {
    this.repo = new ReviewRepository(container.db);
  }

  async run(reviewId: string, ref: PullRequestRef): Promise<number> {
    const diff = await this.container.github.getPullRequestDiff(ref);
    const answer = await this.container.llm.complete(`Review this diff:\n${diff}`);
    const findingsCount = answer.split('\n').filter((l) => l.startsWith('- ')).length;

    await this.repo.markCompleted(reviewId, findingsCount);
    await this.container.github.postComment(ref, answer);
    return findingsCount;
  }
}
