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
    await this.notify(digest);
    return digest;
  }

  latest(repoId: string): Promise<Digest | null> {
    return this.repo.latest(repoId);
  }

  // Best-effort: a Teams outage must never fail digest generation.
  private async notify(digest: Digest): Promise<void> {
    const notifier = this.container.digestNotifier();
    if (!notifier) return;
    try {
      await notifier.postDigest(`Digest for ${digest.repoId}`, digest.body);
    } catch (err) {
      console.warn('digests: failed to post to Teams', err);
    }
  }
}
