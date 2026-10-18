import type { NewTag, Tag } from './types.js';

export interface TagRepository {
  listByRepo(repoId: string): Promise<Tag[]>;
  findByName(repoId: string, name: string): Promise<Tag | null>;
  insert(input: NewTag): Promise<Tag>;
  /** Returns true if a row was deleted. */
  delete(repoId: string, tagId: string): Promise<boolean>;
}
