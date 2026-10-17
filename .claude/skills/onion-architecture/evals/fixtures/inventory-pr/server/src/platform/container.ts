import type { Db } from '../db/client.js';

export class Container {
  constructor(readonly db: Db) {}
}
