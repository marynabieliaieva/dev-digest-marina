import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Repos live in another module/table; kept as a plain id (no FK) so this module stays decoupled.
    repoId: uuid('repo_id').notNull(),
    name: text('name').notNull(),
    color: text('color').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tags_repo_id_name_uq').on(t.repoId, t.name),
    index('tags_repo_id_idx').on(t.repoId),
  ],
);

export type TagRow = typeof tags.$inferSelect;
export type NewTagRow = typeof tags.$inferInsert;
