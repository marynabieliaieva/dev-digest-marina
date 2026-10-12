import { pgTable, uuid, text, integer, primaryKey, index } from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { skills } from './skills';

// ============================================================ Project context
// Attachments store repo-relative document PATHS only (never document text) and
// carry no version columns: attaching context does not bump agent/skill versions.

export const agentContextDocs = pgTable(
  'agent_context_docs',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.path] }),
    pathIdx: index('agent_context_docs_path_idx').on(t.path),
  }),
);

export const skillContextDocs = pgTable(
  'skill_context_docs',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.skillId, t.path] }),
    pathIdx: index('skill_context_docs_path_idx').on(t.path),
  }),
);
