import type { Ticket } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ExternalServiceError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { TicketRepository } from './repository.js';

export class TicketService {
  private readonly repo: TicketRepository;

  constructor(private readonly container: Container) {
    this.repo = new TicketRepository(container.db);
  }

  async get(id: string): Promise<Ticket> {
    const ticket = await this.repo.get(id);
    if (!ticket) throw new NotFoundError('Ticket not found');
    return ticket;
  }

  async assign(id: string, assignee: string): Promise<Ticket> {
    const ticket = await this.get(id);
    if (ticket.status === 'closed') throw new ValidationError('Ticket is already closed');

    // GitHub first: if it fails, the DB is left untouched and the caller sees the error.
    try {
      await this.container.issues.assign(ticket.issueNumber, assignee);
    } catch (err) {
      throw new ExternalServiceError('Failed to assign issue on GitHub', {
        cause: err instanceof Error ? err.message : String(err),
      });
    }

    const updated = await this.repo.setAssignee(id, assignee);
    if (!updated) throw new NotFoundError('Ticket not found');
    return updated;
  }
}
