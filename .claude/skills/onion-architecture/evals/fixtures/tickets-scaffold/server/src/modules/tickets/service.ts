import type { Ticket } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
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
}
