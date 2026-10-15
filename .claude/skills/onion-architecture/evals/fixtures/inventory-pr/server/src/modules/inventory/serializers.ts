import { inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import * as suppliers from '../../db/schema/suppliers.js';
import type { InventoryItem } from '@devdigest/shared';

export async function withSupplierNames(
  items: Omit<InventoryItem, 'supplierName'>[],
): Promise<InventoryItem[]> {
  const ids = items.map((i) => i.supplierId).filter((id): id is string => id !== null);
  const rows = ids.length
    ? await db.select().from(suppliers.suppliers).where(inArray(suppliers.suppliers.id, ids))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r.name]));
  return items.map((i) => ({ ...i, supplierName: i.supplierId ? (byId.get(i.supplierId) ?? null) : null }));
}
