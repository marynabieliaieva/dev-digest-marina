import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema/inventory.js';
import type { InventoryItem } from '@devdigest/shared';

type ItemRow = typeof t.items.$inferSelect;

export type PlainItem = Omit<InventoryItem, 'supplierName'>;

const toItem = (row: ItemRow): PlainItem => ({
  id: row.id,
  sku: row.sku,
  name: row.name,
  quantity: row.quantity,
  supplierId: row.supplierId,
});

export class InventoryRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<PlainItem[]> {
    return (await this.db.select().from(t.items)).map(toItem);
  }

  async get(id: string): Promise<PlainItem | null> {
    const [row] = await this.db.select().from(t.items).where(eq(t.items.id, id));
    return row ? toItem(row) : null;
  }

  async listBySupplier(supplierId: string): Promise<PlainItem[]> {
    const rows = await this.db.select().from(t.items).where(eq(t.items.supplierId, supplierId));
    return rows.map(toItem);
  }

  async setQuantity(id: string, quantity: number): Promise<PlainItem | null> {
    const [row] = await this.db.update(t.items).set({ quantity }).where(eq(t.items.id, id)).returning();
    return row ? toItem(row) : null;
  }
}
