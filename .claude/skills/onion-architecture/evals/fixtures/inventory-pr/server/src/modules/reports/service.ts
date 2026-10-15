import type { Container } from '../../platform/container.js';
import { InventoryRepository } from '../inventory/repository.js';
import { SupplierService } from '../suppliers/service.js';
import { formatRow } from './format.js';

export class ReportService {
  constructor(private readonly container: Container) {}

  async stockReport(): Promise<string[]> {
    const items = await new InventoryRepository(this.container.db).list();
    const suppliers = new SupplierService(this.container);

    const lines: string[] = [];
    for (const item of items) {
      const supplier = item.supplierId ? await suppliers.get(item.supplierId) : null;
      lines.push(formatRow(item.sku, item.quantity, supplier?.name ?? 'none'));
    }
    return lines;
  }
}
