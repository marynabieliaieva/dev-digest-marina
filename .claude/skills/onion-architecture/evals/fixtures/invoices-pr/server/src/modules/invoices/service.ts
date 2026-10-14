import type { Invoice } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { invoices } from '../../db/schema/invoices.js';
import { InvoiceRepository } from './repository.js';

export class InvoiceService {
  private readonly repo: InvoiceRepository;

  constructor(private readonly container: Container) {
    this.repo = new InvoiceRepository(container.db);
  }

  async create(values: typeof invoices.$inferInsert): Promise<Invoice> {
    const invoice = await this.repo.insert(values);
    await this.container.email.send({
      to: invoice.customerEmail,
      subject: `Invoice ${invoice.id}`,
      body: `Amount due: ${invoice.amountCents / 100} ${invoice.currency}, by ${invoice.dueDate}`,
    });
    return invoice;
  }

  async markPaid(id: string): Promise<Invoice | null> {
    return this.repo.markPaid(id);
  }
}
