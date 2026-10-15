import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema/billing.js';
import type { Invoice } from '@devdigest/shared';
import type { InvoiceRow } from './types.js';

const toInvoice = (row: InvoiceRow): Invoice => ({
  id: row.id,
  number: row.number,
  customerId: row.customerId,
  amountCents: row.amountCents,
  currency: row.currency,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
});

export class InvoiceRepository {
  constructor(private readonly db: Db) {}

  async get(id: string): Promise<Invoice | null> {
    const [row] = await this.db.select().from(t.invoices).where(eq(t.invoices.id, id));
    return row ? toInvoice(row) : null;
  }

  async getRow(id: string): Promise<InvoiceRow | null> {
    const [row] = await this.db.select().from(t.invoices).where(eq(t.invoices.id, id));
    return row ?? null;
  }

  async listForCustomer(customerId: string): Promise<Invoice[]> {
    const rows = await this.db.select().from(t.invoices).where(eq(t.invoices.customerId, customerId));
    return rows.map(toInvoice);
  }

  async insert(number: string, customerId: string, amountCents: number, currency: string): Promise<Invoice> {
    const [row] = await this.db
      .insert(t.invoices)
      .values({ number, customerId, amountCents, currency, status: 'open' })
      .returning();
    return toInvoice(row);
  }
}
