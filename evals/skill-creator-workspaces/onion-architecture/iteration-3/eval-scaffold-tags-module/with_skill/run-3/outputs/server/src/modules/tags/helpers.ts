import type { Tag } from '@devdigest/shared';
import type { TagRow } from './repository.js';

export function toTagDto(row: TagRow): Tag {
  return {
    id: row.id,
    repoId: row.repoId,
    name: row.name,
    color: row.color,
    createdAt: row.createdAt.toISOString(),
  };
}
