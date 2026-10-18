import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // TODO: add .references(() => repos.id, { onDelete: 'cascade' }) once wired into the real
    // schema (the repos table is not part of this scaffold).
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
