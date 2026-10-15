import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema/tickets.js';
import type { Ticket } from '@devdigest/shared';

type TicketRow = typeof t.tickets.$inferSelect;

const toTicket = (row: TicketRow): Ticket => ({
  id: row.id,
  title: row.title,
  issueNumber: row.issueNumber,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
});

export class TicketRepository {
  constructor(private readonly db: Db) {}

  async get(id: string): Promise<Ticket | null> {
    const [row] = await this.db.select().from(t.tickets).where(eq(t.tickets.id, id));
    return row ? toTicket(row) : null;
  }

  async setStatus(id: string, status: Ticket['status']): Promise<Ticket | null> {
    const [row] = await this.db.update(t.tickets).set({ status }).where(eq(t.tickets.id, id)).returning();
    return row ? toTicket(row) : null;
  }
}
