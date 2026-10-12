import type { CreateTagInput, Tag } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConflictError, NotFoundError } from '../../platform/errors.js';
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
    if (await this.repository.findByName(repoId, input.name)) {
      throw new ConflictError(`Tag "${input.name}" already exists in this repo`);
    }
    const row = await this.repository.create({ repoId, name: input.name, color: input.color });
    return toTagDto(row);
  }

  async delete(repoId: string, tagId: string): Promise<void> {
    const deleted = await this.repository.delete(repoId, tagId);
    if (!deleted) throw new NotFoundError(`Tag ${tagId} not found`);
  }
}
