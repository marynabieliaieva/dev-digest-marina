import { pgTable, uuid, text, jsonb, timestamp, integer, doublePrecision, boolean, vector, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';
import { skills } from './skills';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

export const conventionExtractions = pgTable('convention_extractions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  repoId: uuid('repo_id')
    .notNull()
    .references(() => repos.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['running', 'done', 'failed'] }).notNull().default('running'),
  sampledFiles: integer('sampled_files').notNull().default(0),
  candidatesRaw: integer('candidates_raw').notNull().default(0),
  candidatesKept: integer('candidates_kept').notNull().default(0),
  provider: text('provider'),
  model: text('model'),
  error: text('error'),
  createdAt: now(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export const conventions = pgTable('conventions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
  extractionId: uuid('extraction_id').references(() => conventionExtractions.id, {
    onDelete: 'cascade',
  }),
  category: text('category'),
  rule: text('rule').notNull(),
  evidencePath: text('evidence_path'),
  evidenceLine: integer('evidence_line'),
  evidenceSnippet: text('evidence_snippet'),
  confidence: doublePrecision('confidence'),
  status: text('status', { enum: ['pending', 'accepted', 'rejected'] }).notNull().default('pending'),
  edited: boolean('edited').notNull().default(false),
  skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'set null' }),
  createdAt: now(),
});
