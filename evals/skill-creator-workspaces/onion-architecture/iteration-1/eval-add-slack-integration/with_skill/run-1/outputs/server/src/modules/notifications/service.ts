import type { Container } from '../../platform/container.js';

export class NotificationService {
  constructor(private readonly container: Container) {}

  /** No-op when no notification channel is configured. */
  async notifyReviewDone(reviewId: string, findingsCount: number): Promise<void> {
    const notifications = await this.container.notifications();
    if (!notifications) return;
    await notifications.postMessage(
      `Review ${reviewId} finished: ${findingsCount} finding${findingsCount === 1 ? '' : 's'}.`,
    );
  }
}
