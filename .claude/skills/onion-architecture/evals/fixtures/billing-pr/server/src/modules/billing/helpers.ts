import { count } from 'drizzle-orm';
import { db } from '../../db/client.js';
import * as t from '../../db/schema/billing.js';
import { INVOICE_PREFIX } from './constants.js';

export function formatAmount(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

export async function nextInvoiceNumber(): Promise<string> {
  const [row] = await db.select({ n: count() }).from(t.invoices);
  return `${INVOICE_PREFIX}-${String((row?.n ?? 0) + 1).padStart(6, '0')}`;
}
