import type { Ticket } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConflictError, ExternalServiceError, NotFoundError } from '../../platform/errors.js';
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
    const ticket = await this.get(id); // 404 if missing
    if (ticket.status === 'closed') {
      throw new ConflictError('Ticket is closed and cannot be assigned');
    }

    // GitHub first: if it fails, nothing has been persisted locally, so the DB
    // and GitHub never disagree. The failure surfaces to the caller as a 502.
    try {
      await this.container.issues.assign(ticket.issueNumber, assignee);
    } catch (err) {
      throw new ExternalServiceError('Failed to assign the issue on GitHub', {
        cause: err instanceof Error ? err.message : String(err),
      });
    }

    const updated = await this.repo.setAssignee(id, assignee);
    if (!updated) throw new NotFoundError('Ticket not found');
    return updated;
  }
}
