import * as t from '../../db/schema/billing.js';

export type InvoiceRow = typeof t.invoices.$inferSelect;
export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void';
