import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema/customers.js';
import type { Customer } from '@devdigest/shared';

export class CustomerRepository {
  constructor(private readonly db: Db) {}

  async get(id: string): Promise<Customer | null> {
    const [row] = await this.db.select().from(t.customers).where(eq(t.customers.id, id));
    return row ? { id: row.id, name: row.name, blocked: row.blocked } : null;
  }
}
