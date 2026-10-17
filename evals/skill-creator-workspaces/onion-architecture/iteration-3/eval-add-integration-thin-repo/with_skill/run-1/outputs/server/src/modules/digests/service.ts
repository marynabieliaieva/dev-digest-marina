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
    await this.postToTeams(digest);
    return digest;
  }

  latest(repoId: string): Promise<Digest | null> {
    return this.repo.latest(repoId);
  }

  // Best-effort: a Teams outage must never fail digest generation.
  private async postToTeams(digest: Digest): Promise<void> {
    try {
      const notifier = await this.container.digestNotifier();
      await notifier?.notifyDigest(`Digest for ${digest.repoId}`, digest.body);
    } catch (err) {
      console.warn('digests: failed to post to Teams', err);
    }
  }
}
