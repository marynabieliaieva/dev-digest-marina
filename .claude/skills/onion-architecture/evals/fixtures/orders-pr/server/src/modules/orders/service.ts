import type { Order } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { CustomerService } from '../customers/service.js';
import { OrderRepository } from './repository.js';
import { MAX_ITEMS_PER_ORDER, MIN_ORDER_CENTS } from './constants.js';

export class OrderService {
  private readonly repo: OrderRepository;

  constructor(private readonly container: Container) {
    this.repo = new OrderRepository(container.db);
  }

  async place(customerId: string, itemCount: number, totalCents: number): Promise<Order> {
    if (itemCount < 1 || itemCount > MAX_ITEMS_PER_ORDER) {
      throw new ValidationError('invalid_item_count');
    }
    if (totalCents < MIN_ORDER_CENTS) {
      throw new ValidationError('order_too_small');
    }

    const customers = new CustomerService(this.container);
    const customer = await customers.get(customerId);
    if (!customer) throw new NotFoundError('customer_not_found');
    if (customer.blocked) throw new ConflictError('customer_blocked');

    return this.repo.insert(customerId, totalCents);
  }

  async cancel(id: string): Promise<Order> {
    const order = await this.repo.get(id);
    if (!order) throw new NotFoundError('order_not_found');
    if (order.status === 'shipped') throw new ConflictError('already_shipped');

    const updated = await this.repo.setStatus(id, 'cancelled');
    if (!updated) throw new NotFoundError('order_not_found');
    return updated;
  }
}
