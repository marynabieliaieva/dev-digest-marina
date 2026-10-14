import type { Customer } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConflictError, NotFoundError } from '../../platform/errors.js';
import { BillingService } from '../billing/service.js';
import { CustomerRepository } from './repository.js';

export class CustomerService {
  private readonly repo: CustomerRepository;

  constructor(private readonly container: Container) {
    this.repo = new CustomerRepository(container.db);
  }

  async get(id: string): Promise<Customer> {
    const customer = await this.repo.get(id);
    if (!customer) throw new NotFoundError('Customer not found');
    return customer;
  }

  async assertActive(id: string): Promise<void> {
    const customer = await this.get(id);
    if (!customer.active) throw new ConflictError('Customer is not active');
  }

  async canBeDeactivated(id: string): Promise<boolean> {
    const outstanding = await new BillingService(this.container).totalOutstanding(id);
    return outstanding === 0;
  }
}
