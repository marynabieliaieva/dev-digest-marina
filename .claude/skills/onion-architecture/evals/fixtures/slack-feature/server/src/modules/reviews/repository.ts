import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema/reviews.js';

export class ReviewRepository {
  constructor(private readonly db: Db) {}

  async markCompleted(reviewId: string, findingsCount: number): Promise<void> {
    await this.db
      .update(t.reviews)
      .set({ status: 'completed', findingsCount, completedAt: new Date() })
      .where(eq(t.reviews.id, reviewId));
  }
}
