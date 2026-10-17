import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { TAG_COLOR_PATTERN, TAG_NAME_MAX_LENGTH } from './constants.js';
import type { NewTag, Tag, TagRepositoryPort } from './types.js';

export class TagService {
  constructor(private readonly repo: TagRepositoryPort) {}

  list(repoId: string): Promise<Tag[]> {
    return this.repo.listByRepo(repoId);
  }

  async create(input: NewTag): Promise<Tag> {
    const name = input.name.trim();
    if (!name || name.length > TAG_NAME_MAX_LENGTH) {
      throw new ValidationError(`Tag name must be 1-${TAG_NAME_MAX_LENGTH} characters`);
    }
    if (!TAG_COLOR_PATTERN.test(input.color)) {
      throw new ValidationError('Tag color must be a #RRGGBB hex value');
    }
    if (await this.repo.findByName(input.repoId, name)) {
      throw new ConflictError(`Tag "${name}" already exists in this repo`);
    }
    return this.repo.create({ repoId: input.repoId, name, color: input.color });
  }

  async delete(repoId: string, id: string): Promise<void> {
    const deleted = await this.repo.delete(repoId, id);
    if (!deleted) throw new NotFoundError('Tag not found');
  }
}
