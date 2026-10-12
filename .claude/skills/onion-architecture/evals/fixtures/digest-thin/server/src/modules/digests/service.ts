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
    return this.repo.insert(repoId, body);
  }

  latest(repoId: string): Promise<Digest | null> {
    return this.repo.latest(repoId);
  }
}
