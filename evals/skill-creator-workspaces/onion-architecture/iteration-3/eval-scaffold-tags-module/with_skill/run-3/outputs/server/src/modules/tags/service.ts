import type { CreateTagInput, Tag } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConflictError, NotFoundError } from '../../platform/errors.js';
import { TagRepository } from './repository.js';

export class TagService {
  private repository: TagRepository;

  constructor(container: Container) {
    this.repository = new TagRepository(container.db);
  }

  list(repoId: string): Promise<Tag[]> {
    return this.repository.listByRepo(repoId);
  }

  async create(repoId: string, input: CreateTagInput): Promise<Tag> {
    if (await this.repository.findByName(repoId, input.name)) {
      throw new ConflictError(`Tag "${input.name}" already exists`);
    }
    return this.repository.create(repoId, input);
  }

  async delete(repoId: string, id: string): Promise<void> {
    const deleted = await this.repository.delete(repoId, id);
    if (!deleted) throw new NotFoundError(`Tag ${id} not found`);
  }
}
