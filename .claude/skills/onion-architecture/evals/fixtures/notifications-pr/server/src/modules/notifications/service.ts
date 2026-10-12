import { Octokit } from 'octokit';
import type { Notification } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotificationRepository, type NotificationRow } from './repository.js';
import { toNotificationDto } from './helpers.js';
import { DEFAULT_CHANNEL, MAX_NOTIFICATIONS_PER_PAGE } from './constants.js';

export class NotificationService {
  private readonly repo: NotificationRepository;

  constructor(private readonly container: Container) {
    this.repo = new NotificationRepository(container.db);
  }

  async list(userId: string, limit = MAX_NOTIFICATIONS_PER_PAGE): Promise<Notification[]> {
    const rows = await this.repo.listForUser(userId, limit);
    return rows.map(toNotificationDto);
  }

  async getLatestRow(userId: string): Promise<NotificationRow | undefined> {
    const rows = await this.repo.listForUser(userId, 1);
    return rows[0];
  }

  async syncFromGitHub(userId: string, token: string): Promise<number> {
    const octokit = new Octokit({ auth: token });
    const res = await octokit.rest.activity.listNotificationsForAuthenticatedUser();
    return res.data.filter((n) => n.reason !== DEFAULT_CHANNEL).length;
  }

  async markRead(userId: string, id: string): Promise<void> {
    await this.repo.markRead(userId, id);
  }
}
