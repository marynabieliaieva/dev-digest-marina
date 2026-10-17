import type { CreateTagInput, Tag } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { MAX_TAGS_PER_REPO } from './constants.js';
import { toTagDto } from './helpers.js';
import { TagRepository } from './repository.js';

export class TagService {
  private repository: TagRepository;

  constructor(container: Container) {
    this.repository = new TagRepository(container.db);
  }

  async list(repoId: string): Promise<Tag[]> {
    const rows = await this.repository.listByRepo(repoId);
    return rows.map(toTagDto);
  }

  async create(repoId: string, input: CreateTagInput): Promise<Tag> {
    if ((await this.repository.countByRepo(repoId)) >= MAX_TAGS_PER_REPO) {
      throw new ValidationError(`A repo can have at most ${MAX_TAGS_PER_REPO} tags`);
    }
    const row = await this.repository.insert(repoId, input.name, input.color);
    if (!row) throw new ConflictError(`Tag "${input.name}" already exists in this repo`);
    return toTagDto(row);
  }

  async delete(repoId: string, tagId: string): Promise<void> {
    const deleted = await this.repository.delete(repoId, tagId);
    if (!deleted) throw new NotFoundError(`Tag ${tagId} not found`);
  }
}
