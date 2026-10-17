import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import { PrBrief } from '@devdigest/shared';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
} from './seed-prompts.js';
import { SEED_SKILLS } from './seed-skills.js';
import { CONTROL_PRS } from './seed-control-prs.js';
import { SEED_EVAL_FINDINGS } from './seed-eval-findings.js';
import { SEED_CONVENTIONS, SEED_EXTRACTION } from './seed-conventions.js';
import { seedProjectContextFixture } from './seed-project-context.js';
import { loadConfig } from '../platform/config.js';

/**
 * Which starter skills each built-in agent links to, in prompt order. Named
 * rather than keyed by id so the mapping survives a re-seed, and so it reads as
 * documentation of what each agent is actually configured to do.
 */
const AGENT_SKILL_LINKS: Record<string, string[]> = {
  'General Reviewer': ['pr-quality-rubric', 'no-then-chains'],
  'Security Reviewer': ['secret-leakage-gate', 'lethal-trifecta', 'phantom-api-gate'],
  'Test Quality Reviewer': ['test-quality-rubric'],
  // Part 3 split: the four granular skills replace the single api-contract-gate
  // on this agent. `breaking-change` is loaded by hand through the skills
  // import flow (not seeded), so a fresh workspace links only the three that
  // exist yet — the missing one is skipped by seedAgentSkillLinks below.
  'API Contract Reviewer': [
    'breaking-change',
    'response-schema',
    'semver-discipline',
    'deprecation-policy',
  ],
};

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, and the three built-in agents (General + Security +
 * Performance), all on the default openrouter/deepseek-v4-flash provider+model.
 *
 * Course lessons populate the other tables (skills, conventions, memory, eval,
 * …) once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description:
        'Checks the tests that ship with a change: uncovered branches, missing corner cases, over-mocking, flakes.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'API Contract Reviewer',
      description: 'Catches breaking changes to route signatures, schemas and response shapes.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  await seedSkills(db, workspaceId);
  await seedAgentSkillLinks(db, workspaceId);
  await seedControlPrs(db, workspaceId, repoId);
  await seedEvalFindings(db, workspaceId, repoId);
  await seedConventions(db, workspaceId, repoId);
  await seedPrBrief(db, pr!.id);

  return { workspaceId, userId };
}

/**
 * Starter skills. Idempotent by name, like the agents: re-seeding an existing
 * workspace must not duplicate a skill or clobber a body the user has edited.
 */
async function seedSkills(db: Db, workspaceId: string): Promise<void> {
  for (const skill of SEED_SKILLS) {
    const [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, skill.name)));
    if (existing) continue;

    const [row] = await db
      .insert(t.skills)
      .values({
        workspaceId,
        name: skill.name,
        description: skill.description,
        type: skill.type,
        source: skill.source,
        body: skill.body,
        enabled: true,
        version: 1,
      })
      .returning();
    // Mirror the repository's contract: v1 always has a body snapshot, so the
    // version history is complete for seeded skills too.
    await db
      .insert(t.skillVersions)
      .values({ skillId: row!.id, version: 1, body: row!.body })
      .onConflictDoNothing();
  }
}

/** Link the starter skills to the built-in agents, in prompt order. */
async function seedAgentSkillLinks(db: Db, workspaceId: string): Promise<void> {
  for (const [agentName, skillNames] of Object.entries(AGENT_SKILL_LINKS)) {
    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, agentName)));
    if (!agent) continue;

    // Only seed links for an agent that has none — otherwise a re-seed would
    // undo a reordering or a per-agent toggle the user made in the editor.
    const existing = await db
      .select()
      .from(t.agentSkills)
      .where(eq(t.agentSkills.agentId, agent.id));
    if (existing.length > 0) continue;

    for (const [order, skillName] of skillNames.entries()) {
      const [skill] = await db
        .select()
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, skillName)));
      if (!skill) continue;
      await db
        .insert(t.agentSkills)
        .values({ agentId: agent.id, skillId: skill.id, order, enabled: true })
        .onConflictDoNothing();
    }
  }
}

/**
 * The two demo PRs the skills control experiment runs against. Unlike PR #482
 * these carry real `patch` text, so `diffFromPrFiles` can reconstruct a diff
 * and a review actually has something to read without a clone.
 */
async function seedControlPrs(db: Db, workspaceId: string, repoId: string): Promise<void> {
  for (const spec of CONTROL_PRS) {
    const [existing] = await db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, spec.number)));
    if (existing) continue;

    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: spec.number,
        title: spec.title,
        author: spec.author,
        branch: spec.branch,
        base: spec.base,
        headSha: spec.headSha,
        additions: spec.files.reduce((n, f) => n + f.additions, 0),
        deletions: spec.files.reduce((n, f) => n + f.deletions, 0),
        filesCount: spec.files.length,
        status: 'needs_review',
        body: spec.body,
      })
      .returning();

    await db.insert(t.prFiles).values(
      spec.files.map((f) => ({
        prId: pr!.id,
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
      })),
    );
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: spec.headSha,
      message: spec.commitMessage,
      author: spec.author,
    });
  }
}

/**
 * Undecided starter findings per built-in agent, for building eval sets. One
 * review per (agent, PR); skipped when that review already exists so a re-seed
 * never resurrects findings the user has accepted, dismissed or deleted.
 */
async function seedEvalFindings(db: Db, workspaceId: string, repoId: string): Promise<void> {
  const groups = new Map<string, typeof SEED_EVAL_FINDINGS>();
  for (const f of SEED_EVAL_FINDINGS) {
    const key = `${f.agent}|${f.pr}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }

  for (const [key, items] of groups) {
    const [agentName, prNumber] = key.split('|') as [string, string];
    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, agentName)));
    const [pull] = await db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, Number(prNumber))));
    if (!agent || !pull) continue;

    const [existing] = await db
      .select()
      .from(t.reviews)
      .where(
        and(eq(t.reviews.prId, pull.id), eq(t.reviews.agentId, agent.id), eq(t.reviews.model, 'seed-eval')),
      );
    if (existing) continue;

    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pull.id,
        agentId: agent.id,
        kind: 'review',
        verdict: 'comment',
        summary: `Seeded ${agentName} findings for building an eval set.`,
        model: 'seed-eval',
      })
      .returning();

    await db.insert(t.findings).values(
      items.map((f) => ({
        reviewId: review!.id,
        file: f.file,
        startLine: f.startLine,
        endLine: f.endLine,
        severity: f.severity,
        category: f.category,
        title: f.title,
        rationale: f.rationale,
        suggestion: f.suggestion,
        confidence: f.confidence,
      })),
    );
  }
}

/**
 * A cached PR Brief for PR #482 so the Overview card and the e2e flow work with
 * no model call. `head_sha` equals the seeded PR head, so it is not stale and
 * the client sends no POST. Upserted so a re-seed restores it.
 */
async function seedPrBrief(db: Db, prId: string): Promise<void> {
  const brief = PrBrief.parse({
    intent: null,
    blast: null,
    risks: {
      risks: [
        {
          kind: 'security',
          title: 'Secret committed in config',
          explanation: 'A live-looking secret key is present in the public API configuration.',
          severity: 'high',
          file_refs: ['src/config.ts'],
        },
      ],
    },
    history: { history: [] },
    summary: 'Seeded brief: rate limiting touches the public API config.',
    review_focus: [
      { file: 'src/config.ts', line: 12, reason: 'Hardcoded secret key on this line.' },
    ],
    head_sha: 'a1b2c3d4e5f6',
    generated_at: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    provider: 'openai',
    model: 'seed',
    tokens_in: 0,
    tokens_out: 0,
    cost_usd: null,
    attempts: 1,
    data_gaps: [],
    inputs: [],
    dropped: { risks: 0, risk_file_refs: 0, review_focus: 0 },
  });
  await db
    .insert(t.prBrief)
    .values({ prId, json: brief })
    .onConflictDoUpdate({ target: t.prBrief.prId, set: { json: brief } });
}

/**
 * A `done` extraction + its accepted-none candidates, so `/repos/:id/conventions`
 * renders (and the e2e flow has something to accept) with no API key. Idempotent:
 * skipped once payments-api already has an extraction row.
 */
async function seedConventions(db: Db, workspaceId: string, repoId: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(t.conventionExtractions)
    .where(and(eq(t.conventionExtractions.workspaceId, workspaceId), eq(t.conventionExtractions.repoId, repoId)));
  if (existing) return;

  const [extraction] = await db
    .insert(t.conventionExtractions)
    .values({
      workspaceId,
      repoId,
      status: 'done',
      sampledFiles: SEED_EXTRACTION.sampledFiles,
      candidatesRaw: SEED_EXTRACTION.candidatesRaw,
      candidatesKept: SEED_EXTRACTION.candidatesKept,
      provider: SEED_EXTRACTION.provider,
      model: SEED_EXTRACTION.model,
      finishedAt: new Date(),
    })
    .returning();

  await db.insert(t.conventions).values(
    SEED_CONVENTIONS.map((c) => ({
      workspaceId,
      repoId,
      extractionId: extraction!.id,
      category: c.category,
      rule: c.rule,
      evidencePath: c.evidencePath,
      evidenceLine: c.evidenceLine,
      evidenceSnippet: c.evidenceSnippet,
      confidence: c.confidence,
      status: 'pending' as const,
    })),
  );
}

// CLI entrypoint. Compares real filesystem paths (not raw URL strings) so
// this also works on Windows — see the comment in migrate.ts for why the
// naive `file://${process.argv[1]}` comparison silently fails there.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      await seedProjectContextFixture(handle.db, loadConfig().cloneDir);
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
