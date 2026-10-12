import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema/orders.js';
import type { Order } from '@devdigest/shared';

type OrderRow = typeof t.orders.$inferSelect;

const toOrder = (row: OrderRow): Order => ({
  id: row.id,
  customerId: row.customerId,
  totalCents: row.totalCents,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
});

export class OrderRepository {
  constructor(private readonly db: Db) {}

  async get(id: string): Promise<Order | null> {
    const [row] = await this.db.select().from(t.orders).where(eq(t.orders.id, id));
    return row ? toOrder(row) : null;
  }

  async insert(customerId: string, totalCents: number): Promise<Order> {
    const [row] = await this.db
      .insert(t.orders)
      .values({ customerId, totalCents, status: 'pending' })
      .returning();
    return toOrder(row);
  }

  async setStatus(id: string, status: Order['status']): Promise<Order | null> {
    const [row] = await this.db.update(t.orders).set({ status }).where(eq(t.orders.id, id)).returning();
    return row ? toOrder(row) : null;
  }
}
