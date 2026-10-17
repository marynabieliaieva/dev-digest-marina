import type { Ticket } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { TicketRepository } from './repository.js';

export class TicketService {
  private readonly repo: TicketRepository;

  constructor(private readonly container: Container) {
    this.repo = new TicketRepository(container.db);
  }

  get(id: string): Promise<Ticket | null> {
    return this.repo.get(id);
  }

  async close(id: string): Promise<Ticket> {
    const ticket = await this.repo.get(id);
    if (!ticket) throw new Error('ticket_not_found');
    if (ticket.status === 'closed') throw new Error('ticket_already_closed');

    await this.container.issues.close(ticket.issueNumber);
    const updated = await this.repo.setStatus(id, 'closed');
    if (!updated) throw new Error('ticket_not_found');
    return updated;
  }
}
