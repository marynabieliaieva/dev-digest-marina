import type { Digest } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { DigestNotifier } from './ports.js';
import { DigestRepository } from './repository.js';

export class DigestService {
  private readonly repo: DigestRepository;
  private readonly notifier: DigestNotifier | null;

  constructor(private readonly container: Container) {
    this.repo = new DigestRepository(container.db);
    this.notifier = container.digestNotifier;
  }

  async generate(repoId: string, items: string[]): Promise<Digest> {
    const body = items.map((item) => `- ${item}`).join('\n');
    const digest = await this.repo.insert(repoId, body);
    if (this.notifier) {
      try {
        await this.notifier.notify(digest);
      } catch (err) {
        // A failed post must not fail digest generation; the digest is already saved.
        console.error('Failed to post digest to notifier', err);
      }
    }
    return digest;
  }

  latest(repoId: string): Promise<Digest | null> {
    return this.repo.latest(repoId);
  }
}
