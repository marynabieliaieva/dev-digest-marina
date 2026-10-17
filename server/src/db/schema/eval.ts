import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { workspaces } from './core';
import { pullRequests } from './pulls';
import { agents } from './agents';
import { findings } from './reviews';
import { now } from './_shared';

// ============================================================ Eval / Conformance / Compose

export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    inputDiff: text('input_diff'),
    inputFiles: jsonb('input_files'),
    inputMeta: jsonb('input_meta'),
    expectedOutput: jsonb('expected_output'),
    notes: text('notes'),
    // The finding this case was created from; cleared (not cascaded) when it is deleted.
    sourceFindingId: uuid('source_finding_id').references(() => findings.id, {
      onDelete: 'set null',
    }),
    createdAt: now(),
  },
  (t) => ({
    // One case per (owner, source finding); NULLs are distinct so cleared sources never collide.
    ownerSourceUq: uniqueIndex('eval_cases_owner_source_uq').on(
      t.ownerKind,
      t.ownerId,
      t.sourceFindingId,
    ),
  }),
);

/** One execution of an agent's eval set (scope 'set') or of a single case (scope 'case'). */
export const evalBatches = pgTable(
  'eval_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['set', 'case'] }).notNull(),
    agentVersion: integer('agent_version').notNull(),
    configSnapshot: jsonb('config_snapshot').notNull(),
    status: text('status', { enum: ['running', 'done', 'failed'] }).notNull(),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    casesTotal: integer('cases_total').notNull(),
    casesDone: integer('cases_done').notNull().default(0),
    tracesPassed: integer('traces_passed'),
    tracesTotal: integer('traces_total'),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    costUsd: doublePrecision('cost_usd'),
    durationMs: integer('duration_ms'),
  },
  (t) => ({
    agentScopeStartedIdx: index('eval_batches_agent_scope_started_idx').on(
      t.agentId,
      t.scope,
      t.startedAt,
    ),
    // DB-level guarantee: at most one running batch per agent (back-to-back POSTs).
    oneRunningPerAgentUq: uniqueIndex('eval_batches_one_running_per_agent_uq')
      .on(t.agentId)
      .where(sql`${t.status} = 'running'`),
  }),
);

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => evalCases.id, { onDelete: 'cascade' }),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => evalBatches.id, { onDelete: 'cascade' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    actualOutput: jsonb('actual_output'),
    pass: boolean('pass'),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
    error: text('error'),
  },
  (t) => ({
    batchIdx: index('eval_runs_batch_idx').on(t.batchId),
    caseIdx: index('eval_runs_case_idx').on(t.caseId),
  }),
);

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
