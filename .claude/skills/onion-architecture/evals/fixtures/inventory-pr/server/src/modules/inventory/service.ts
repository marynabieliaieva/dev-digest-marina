import type { InventoryItem } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { SupplierService } from '../suppliers/service.js';
import { InventoryRepository, type PlainItem } from './repository.js';
import { LOW_STOCK_THRESHOLD, MAX_RESTOCK_QUANTITY } from './constants.js';

export class InventoryService {
  private readonly repo: InventoryRepository;

  constructor(private readonly container: Container) {
    this.repo = new InventoryRepository(container.db);
  }

  list(): Promise<PlainItem[]> {
    return this.repo.list();
  }

  listBySupplier(supplierId: string): Promise<PlainItem[]> {
    return this.repo.listBySupplier(supplierId);
  }

  async restock(id: string, amount: number): Promise<PlainItem> {
    if (amount < 1 || amount > MAX_RESTOCK_QUANTITY) throw new ValidationError('invalid_amount');
    const item = await this.repo.get(id);
    if (!item) throw new NotFoundError('Item not found');

    const updated = await this.repo.setQuantity(id, item.quantity + amount);
    if (!updated) throw new NotFoundError('Item not found');
    return updated;
  }

  async lowStock(): Promise<PlainItem[]> {
    const items = await this.repo.list();
    return items.filter((i) => i.quantity < LOW_STOCK_THRESHOLD);
  }

  async requestRestock(id: string): Promise<void> {
    const item = await this.repo.get(id);
    if (!item?.supplierId) throw new NotFoundError('Item has no supplier');
    await new SupplierService(this.container).notifyRestockNeeded(item.supplierId, item.sku);
  }
}

export type { InventoryItem };
