import type { Container } from '../../platform/container.js';
import { NotificationRepository } from './repository.js';

export class NotificationService {
  private readonly repo: NotificationRepository;

  constructor(container: Container) {
    this.repo = new NotificationRepository(container.db);
  }

  async record(channel: string, title: string): Promise<void> {
    await this.repo.insert(channel, title);
  }
}
