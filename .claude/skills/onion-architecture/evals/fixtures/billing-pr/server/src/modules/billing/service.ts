import type { Invoice } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { stripe } from '../../lib/payments.js';
import { CustomerRepository } from '../customers/repository.js';
import { CustomerService } from '../customers/service.js';
import { NotificationService } from '../notifications/service.js';
import { InvoiceRepository } from './repository.js';
import { formatAmount, nextInvoiceNumber } from './helpers.js';
import { DEFAULT_CURRENCY, MAX_LINE_ITEMS } from './constants.js';
import type { InvoiceRow } from './types.js';

export class BillingService {
  private readonly repo: InvoiceRepository;

  constructor(private readonly container: Container) {
    this.repo = new InvoiceRepository(container.db);
  }

  async create(customerId: string, lineItemCount: number, amountCents: number): Promise<Invoice> {
    if (lineItemCount < 1 || lineItemCount > MAX_LINE_ITEMS) {
      throw new ValidationError('invalid_line_item_count');
    }

    const customer = await new CustomerRepository(this.container.db).get(customerId);
    if (!customer) throw new NotFoundError('Customer not found');

    const number = await nextInvoiceNumber();
    const invoice = await this.repo.insert(number, customerId, amountCents, DEFAULT_CURRENCY);

    await stripe.invoices.create({ customer: customer.stripeId, description: number });
    await new NotificationService(this.container).record(
      'billing',
      `Invoice ${number}: ${formatAmount(amountCents, DEFAULT_CURRENCY)}`,
    );
    return invoice;
  }

  async getRow(id: string): Promise<InvoiceRow | null> {
    return this.repo.getRow(id);
  }

  async totalOutstanding(customerId: string): Promise<number> {
    const customers = new CustomerService(this.container);
    await customers.assertActive(customerId);
    const invoices = await this.repo.listForCustomer(customerId);
    return invoices.filter((i) => i.status === 'open').reduce((sum, i) => sum + i.amountCents, 0);
  }
}
