import type { PullRequestRef } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotificationService } from '../notifications/service.js';
import { ReviewRepository } from './repository.js';

export class ReviewService {
  private readonly repo: ReviewRepository;
  private readonly notifications: NotificationService;

  constructor(private readonly container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.notifications = new NotificationService(container);
  }

  async run(reviewId: string, ref: PullRequestRef): Promise<number> {
    const diff = await this.container.github.getPullRequestDiff(ref);
    const answer = await this.container.llm.complete(`Review this diff:\n${diff}`);
    const findingsCount = answer.split('\n').filter((l) => l.startsWith('- ')).length;

    await this.repo.markCompleted(reviewId, findingsCount);
    await this.container.github.postComment(ref, answer);
    await this.notifications.record('review', `Review finished: ${findingsCount} findings`);
    return findingsCount;
  }
}
