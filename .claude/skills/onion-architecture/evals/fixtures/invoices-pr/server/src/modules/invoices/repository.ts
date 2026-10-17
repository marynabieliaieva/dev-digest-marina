import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema/invoices.js';
import type { Invoice } from '@devdigest/shared';

type InvoiceRow = typeof t.invoices.$inferSelect;

export interface NewInvoice {
  customerEmail: string;
  amountCents: number;
  currency: string;
  dueDate: Date;
}

const toInvoice = (row: InvoiceRow): Invoice => ({
  id: row.id,
  customerEmail: row.customerEmail,
  amountCents: row.amountCents,
  currency: row.currency,
  dueDate: row.dueDate.toISOString(),
  paidAt: row.paidAt ? row.paidAt.toISOString() : null,
});

export class InvoiceRepository {
  constructor(private readonly db: Db) {}

  async get(id: string): Promise<Invoice | null> {
    const [row] = await this.db.select().from(t.invoices).where(eq(t.invoices.id, id));
    return row ? toInvoice(row) : null;
  }

  async insert(values: NewInvoice): Promise<Invoice> {
    const [row] = await this.db.insert(t.invoices).values(values).returning();
    return toInvoice(row);
  }

  async markPaid(id: string): Promise<Invoice | null> {
    const [row] = await this.db
      .update(t.invoices)
      .set({ paidAt: new Date() })
      .where(eq(t.invoices.id, id))
      .returning();
    return row ? toInvoice(row) : null;
  }
}
