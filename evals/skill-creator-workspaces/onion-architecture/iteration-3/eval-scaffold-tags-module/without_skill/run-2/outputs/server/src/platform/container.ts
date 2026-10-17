import type { Db } from '../db/client.js';
import { TagRepository } from '../modules/tags/repository.js';
import { TagService } from '../modules/tags/service.js';

export class Container {
  readonly tags: TagService;

  constructor(readonly db: Db) {
    this.tags = new TagService(new TagRepository(db));
  }
}
