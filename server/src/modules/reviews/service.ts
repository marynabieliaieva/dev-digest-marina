import type { Container } from '../../platform/container.js';
import type {
  FindingActionKind,
  ReviewByRefRequest,
  ReviewByRefResponse,
  RunDetail,
  RunEventKind,
  RunTrace,
} from '@devdigest/shared';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { PullsService } from '../pulls/service.js';
import { ReviewRepository, type PullRow } from './repository.js';
import { type ReviewDto, type ReviewDtoFinding } from './helpers.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import { reviewToDto, runDetailToDto } from './helpers.js';

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/**
 * Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + repo-map + diff)
 *        → llm.completeStructured({ schema: Review }) (single-pass)
 *        → groundFindings(...) (citation gate — drops findings off the diff)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over container.runBus, and on completion writing
 *   the whole log as ONE RunTrace doc + an agent_runs row.
 *
 * Also: the finding accept/dismiss actions. The bulky run execution lives in
 * run-executor; this class keeps the public method surface.
 */
export class ReviewService {
  private repo: ReviewRepository;
  private agents: Container['agentsRepo'];
  private executor: ReviewRunExecutor;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.agents = container.agentsRepo;
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents);
  }

  // ===========================================================================
  // Run a review for one or all enabled agents on a PR.
  // ===========================================================================

  /**
   * Resolve which agents to run. `all` → all enabled agents; else a single agent.
   */
  async resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; all?: boolean },
  ): Promise<AgentRow[]> {
    if (opts.all) return this.agents.listEnabled(workspaceId);
    if (opts.agentId) {
      const agent = await this.agents.getById(workspaceId, opts.agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      return [agent];
    }
    throw new AppError('invalid_run_request', 'Provide agentId or all:true', 400);
  }

  /** Delete a whole review run (one agent's pass) + its findings (cascade). */
  async deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return this.repo.deleteReview(workspaceId, reviewId);
  }

  /** In-flight runs for a PR (server-side source of truth, survives reload). */
  async activeRuns(workspaceId: string, prId: string) {
    return this.repo.activeRunsForPull(workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the run history (incl. failures). */
  async listRuns(workspaceId: string, prId: string) {
    return this.repo.listRunsForPull(workspaceId, prId);
  }

  /** Delete one run from the history (+ its trace). */
  async deleteRun(workspaceId: string, runId: string): Promise<boolean> {
    return this.repo.deleteAgentRun(workspaceId, runId);
  }

  /**
   * Cancel an in-flight run. Signals a live runner to stop at its next
   * checkpoint AND marks the DB row cancelled + completes the bus immediately —
   * so cancel also works for ORPHANED runs (whose background process died on a
   * server restart) where signalling alone would do nothing.
   */
  async cancelRun(runId: string): Promise<void> {
    this.publish(runId, 'info', 'Cancellation requested — stopping…');
    this.container.runBus.cancel(runId);
    await this.repo.cancelRunIfRunning(runId);
    this.container.runBus.complete(runId);
  }

  /** Reap runs left 'running' by a previous (now-dead) process. Called on boot. */
  async reapStaleRuns(): Promise<number> {
    return this.repo.reapStaleRunningRuns();
  }

  /**
   * Run a review for each target agent. Each agent gets its own runId
   * (= agent_runs.id) created up-front so the SSE route can be subscribed
   * before/while the run progresses. A partial failure in one agent does not
   * abort the others.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
  ): Promise<{ runs: { run_id: string; agent_id: string; agent_name: string }[]; reviews: ReviewDto[] }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Create the agent_run rows up front so a runId is available IMMEDIATELY —
    // the client persists these in global state and subscribes to the SSE
    // stream. The actual (slow) review runs in the background below.
    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }

    // Fire-and-forget: the HTTP response returns now with the runIds; reviews
    // are persisted as each agent finishes and the client refetches on SSE done.
    void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error({ prId, err: (err as Error).message }, 'review: background execution crashed');
    });

    return { runs, reviews: [] };
  }

  // ===========================================================================
  // By-reference entry points (repo = owner/name, PR = number) — used by MCP.
  // ===========================================================================

  /** Resolve `owner/name | name` + PR number to a persisted PR (404 with a next step). */
  private async resolvePullByRef(
    workspaceId: string,
    repoRef: string,
    prNumber: number,
    logger?: Logger,
  ): Promise<{ pull: PullRow; repoFullName: string }> {
    return new PullsService(this.container).resolveByRef(
      workspaceId,
      repoRef,
      prNumber,
      logger ?? { warn: () => undefined },
    );
  }

  /** Agent by id, falling back to a case-insensitive name; 404 unknown, 422 disabled. */
  private async resolveAgentByRef(workspaceId: string, ref: string): Promise<AgentRow> {
    const all = await this.agents.list(workspaceId);
    const needle = ref.trim().toLowerCase();
    const agent =
      all.find((a) => a.id === ref) ?? all.find((a) => a.name.trim().toLowerCase() === needle);
    if (!agent) {
      throw new NotFoundError(`Agent "${ref}" not found. List agents to see valid names and ids.`);
    }
    if (!agent.enabled) {
      throw new ValidationError(`Agent "${agent.name}" is disabled. Enable it in devdigest first.`);
    }
    return agent;
  }

  /**
   * Run review(s) for a PR addressed by repo ref + number. An agent that already
   * has a running run on this PR is not started again (`reused: true`).
   */
  async runByRef(
    workspaceId: string,
    input: ReviewByRefRequest,
    logger?: Logger,
  ): Promise<ReviewByRefResponse> {
    if (!input.all && !input.agent) {
      throw new AppError('invalid_run_request', 'Provide agent (id or name) or all:true', 400);
    }
    const { pull, repoFullName } = await this.resolvePullByRef(
      workspaceId,
      input.repo,
      input.pr,
      logger,
    );
    let targets: AgentRow[];
    if (input.all) {
      targets = await this.agents.listEnabled(workspaceId);
      if (targets.length === 0) {
        throw new ValidationError('No enabled agents to run. Enable an agent in devdigest first.');
      }
    } else {
      targets = [await this.resolveAgentByRef(workspaceId, input.agent!)];
    }

    const active = await this.repo.activeRunsForPull(workspaceId, pull.id);
    const activeByAgent = new Map<string, string>();
    for (const r of active) {
      if (r.agent_id && !activeByAgent.has(r.agent_id)) activeByAgent.set(r.agent_id, r.run_id);
    }
    const fresh = targets.filter((a) => !activeByAgent.has(a.id));
    const started = new Map<string, string>();
    if (fresh.length > 0) {
      const { runs } = await this.runReview(workspaceId, pull.id, fresh, logger);
      for (const r of runs) started.set(r.agent_id, r.run_id);
    }

    return {
      pr: { id: pull.id, number: pull.number, title: pull.title, repo_full_name: repoFullName },
      runs: targets.map((a) => {
        const reusedId = activeByAgent.get(a.id);
        return {
          run_id: (reusedId ?? started.get(a.id))!,
          agent_id: a.id,
          agent_name: a.name,
          reused: reusedId !== undefined,
        };
      }),
    };
  }

  /** Latest run of each agent on a PR (newest agent run first), as RunDetail. */
  async latestByRef(
    workspaceId: string,
    repoRef: string,
    prNumber: number,
    logger?: Logger,
  ): Promise<RunDetail[]> {
    const { pull } = await this.resolvePullByRef(workspaceId, repoRef, prNumber, logger);
    const runs = await this.repo.listRunsForPull(workspaceId, pull.id); // newest first
    const seen = new Set<string>();
    const latestIds: string[] = [];
    for (const r of runs) {
      const key = r.agent_id ?? r.run_id;
      if (seen.has(key)) continue;
      seen.add(key);
      latestIds.push(r.run_id);
    }
    return Promise.all(latestIds.map((id) => this.getRunDetail(workspaceId, id)));
  }

  private publish(runId: string, kind: RunEventKind, msg: string, data?: unknown) {
    return this.container.runBus.publish(runId, kind, msg, data);
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
  ): Promise<{ finding: ReviewDtoFinding }> {
    return actOnFindingImpl(this.repo, workspaceId, findingId, action);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async reviewsForPull(workspaceId: string, prId: string): Promise<ReviewDto[]> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const rows = await this.repo.reviewsForPull(prId);
    const names = new Map<string, string>();
    for (const { review } of rows) {
      if (review.agentId && !names.has(review.agentId)) {
        const a = await this.agents.getById(workspaceId, review.agentId);
        if (a) names.set(review.agentId, a.name);
      }
    }
    return rows.map(({ review, findings }) =>
      reviewToDto(review, findings, review.agentId ? names.get(review.agentId) : null),
    );
  }

  /** One run (status, agent, PR/repo refs) + its review when done. Workspace-scoped. */
  async getRunDetail(workspaceId: string, runId: string): Promise<RunDetail> {
    const ctx = await this.repo.getRunContext(workspaceId, runId);
    if (!ctx) throw new NotFoundError('Run not found');
    const reviewRow =
      ctx.run.status === 'done' ? await this.repo.reviewForRun(workspaceId, runId) : undefined;
    return runDetailToDto(ctx, reviewRow);
  }

  async getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return this.repo.getRunTrace(runId);
  }
}
