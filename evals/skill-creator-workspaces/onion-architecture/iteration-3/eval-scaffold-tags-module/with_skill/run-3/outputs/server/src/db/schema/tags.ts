import { pgTable, uuid, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // TODO: add .references(() => repos.id, { onDelete: 'cascade' }) once wired to the real repos schema.
    repoId: uuid('repo_id').notNull(),
    name: text('name').notNull(),
    color: text('color').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    repoNameUnique: uniqueIndex('tags_repo_id_name_idx').on(t.repoId, t.name),
  }),
);
