import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { mailer } from '../../lib/mailer.js';
import { InventoryService } from '../inventory/service.js';
import { SupplierRepository } from './repository.js';
import type { SupplierRow } from './types.js';

export class SupplierService {
  private readonly repo: SupplierRepository;

  constructor(private readonly container: Container) {
    this.repo = new SupplierRepository(container.db);
  }

  async get(id: string): Promise<SupplierRow> {
    const supplier = await this.repo.get(id);
    if (!supplier) throw new NotFoundError('Supplier not found');
    return supplier;
  }

  async notifyRestockNeeded(supplierId: string, sku: string): Promise<void> {
    const supplier = await this.get(supplierId);
    await mailer.emails.send({
      from: 'ops@example.com',
      to: supplier.email,
      subject: `Restock needed: ${sku}`,
      text: `Please restock ${sku}.`,
    });
  }

  async openItemCount(supplierId: string): Promise<number> {
    const items = await new InventoryService(this.container).listBySupplier(supplierId);
    return items.length;
  }
}
