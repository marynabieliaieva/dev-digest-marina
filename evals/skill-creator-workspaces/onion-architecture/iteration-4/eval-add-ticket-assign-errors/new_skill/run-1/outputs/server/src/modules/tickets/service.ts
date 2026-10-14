import type { Ticket } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
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

  async assign(id: string, assignee: unknown): Promise<Ticket> {
    if (typeof assignee !== 'string' || assignee.trim() === '') {
      throw new ValidationError('assignee is required');
    }
    const login = assignee.trim();

    const ticket = await this.get(id); // NotFoundError -> 404
    if (ticket.status === 'closed') {
      throw new ValidationError('Cannot assign a closed ticket');
    }

    // GitHub first: if it fails (ExternalServiceError, 502) we propagate and
    // leave the database untouched, so the two systems never disagree.
    await this.container.issues.assign(ticket.issueNumber, login);

    const updated = await this.repo.setAssignee(id, login);
    if (!updated) throw new NotFoundError('Ticket not found');
    return updated;
  }
}
