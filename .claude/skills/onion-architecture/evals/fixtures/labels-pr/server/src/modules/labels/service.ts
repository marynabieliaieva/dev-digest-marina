import type { Label } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConflictError, ValidationError } from '../../platform/errors.js';
import { LabelRepository } from './repository.js';
import { MAX_LABELS_PER_REPO, MAX_LABEL_LENGTH } from './constants.js';

export class LabelService {
  private readonly repo: LabelRepository;

  constructor(container: Container) {
    this.repo = new LabelRepository(container.db);
  }

  list(repoId: string): Promise<Label[]> {
    return this.repo.listByRepo(repoId);
  }

  async create(repoId: string, name: string, color: string): Promise<Label> {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > MAX_LABEL_LENGTH) {
      throw new ValidationError('invalid_label_name');
    }
    if ((await this.repo.countByRepo(repoId)) >= MAX_LABELS_PER_REPO) {
      throw new ConflictError('label_limit_reached');
    }
    return this.repo.insert(repoId, trimmed, color);
  }

  remove(repoId: string, id: string): Promise<void> {
    return this.repo.remove(repoId, id);
  }
}
