import type { Customer } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { CustomerRepository } from './repository.js';

export class CustomerService {
  private readonly repo: CustomerRepository;

  constructor(container: Container) {
    this.repo = new CustomerRepository(container.db);
  }

  get(id: string): Promise<Customer | null> {
    return this.repo.get(id);
  }
}
