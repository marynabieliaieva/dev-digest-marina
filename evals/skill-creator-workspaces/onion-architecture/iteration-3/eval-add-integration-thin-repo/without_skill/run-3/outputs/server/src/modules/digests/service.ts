import type { Digest } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { DigestRepository } from './repository.js';

export class DigestService {
  private readonly repo: DigestRepository;

  constructor(private readonly container: Container) {
    this.repo = new DigestRepository(container.db);
  }

  async generate(repoId: string, items: string[]): Promise<Digest> {
    const body = items.map((item) => `- ${item}`).join('\n');
    const digest = await this.repo.insert(repoId, body);
    try {
      await this.container.digestNotifier.notify(digest);
    } catch (err) {
      // Notification failure must not fail digest generation.
      console.error('digest notification failed', err);
    }
    return digest;
  }

  latest(repoId: string): Promise<Digest | null> {
    return this.repo.latest(repoId);
  }
}
