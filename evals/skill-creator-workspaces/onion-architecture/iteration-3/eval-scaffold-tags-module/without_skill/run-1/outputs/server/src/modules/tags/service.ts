import { ConflictError, NotFoundError } from '../../platform/errors.js';
import type { TagRepository } from './repository.js';
import type { CreateTagInput, Tag } from './types.js';

export class TagService {
  constructor(private readonly repo: TagRepository) {}

  list(repoId: string): Promise<Tag[]> {
    return this.repo.listByRepo(repoId);
  }

  async create(repoId: string, input: CreateTagInput): Promise<Tag> {
    if (await this.repo.findByName(repoId, input.name)) {
      throw new ConflictError(`Tag "${input.name}" already exists`);
    }
    return this.repo.create(repoId, input);
  }

  async delete(repoId: string, tagId: string): Promise<void> {
    if (!(await this.repo.delete(repoId, tagId))) {
      throw new NotFoundError(`Tag ${tagId} not found`);
    }
  }
}
