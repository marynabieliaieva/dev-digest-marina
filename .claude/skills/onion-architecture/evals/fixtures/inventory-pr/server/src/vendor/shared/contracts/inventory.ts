import { z } from 'zod';
import { LOW_STOCK_THRESHOLD } from '../../../modules/inventory/constants.js';

export const InventoryItem = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  quantity: z.number().int().nonnegative(),
  supplierId: z.string().nullable(),
  supplierName: z.string().nullable(),
});
export type InventoryItem = z.infer<typeof InventoryItem>;

export const isLowStock = (item: InventoryItem) => item.quantity < LOW_STOCK_THRESHOLD;
