import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema/suppliers.js';
import type { SupplierRow } from './types.js';

export class SupplierRepository {
  constructor(private readonly db: Db) {}

  async get(id: string): Promise<SupplierRow | null> {
    const [row] = await this.db.select().from(t.suppliers).where(eq(t.suppliers.id, id));
    return row ?? null;
  }
}
