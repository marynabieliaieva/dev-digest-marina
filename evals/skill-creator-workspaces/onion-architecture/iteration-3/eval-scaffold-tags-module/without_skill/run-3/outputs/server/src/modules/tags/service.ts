import { ConflictError, NotFoundError } from '../../platform/errors.js';
import type { TagRepository } from './ports.js';
import type { NewTag, Tag } from './types.js';

export class TagService {
  constructor(private readonly repo: TagRepository) {}

  list(repoId: string): Promise<Tag[]> {
    return this.repo.listByRepo(repoId);
  }

  async create(input: NewTag): Promise<Tag> {
    if (await this.repo.findByName(input.repoId, input.name)) {
      throw new ConflictError(`Tag "${input.name}" already exists in this repo`);
    }
    return this.repo.insert(input);
  }

  async delete(repoId: string, tagId: string): Promise<void> {
    if (!(await this.repo.delete(repoId, tagId))) {
      throw new NotFoundError(`Tag ${tagId} not found`);
    }
  }
}
