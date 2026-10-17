import type { AgentRunEstimate, MultiAgentRun } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { ReviewService } from '../reviews/service.js';
import type { Logger } from '../reviews/run-executor.js';
import { MultiAgentRepository } from './repository.js';
import { deriveTotals, groupFindings, median } from './helpers.js';
import { ESTIMATE_SAMPLE } from './constants.js';

export class MultiAgentService {
  private repo: MultiAgentRepository;

  constructor(private container: Container) {
    this.repo = new MultiAgentRepository(container.db);
  }

  /**
   * Start one review per selected agent on a PR and group them under a multi-run.
   * Nothing is created until every check passes.
   */
  async start(
    workspaceId: string,
    prId: string,
    agentIds: string[],
    logger?: Logger,
  ): Promise<MultiAgentRun> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    // Match in memory so a non-uuid id gives 404, not a Postgres cast error.
    const all = await this.container.agentsRepo.list(workspaceId);
    const byId = new Map(all.map((a) => [a.id, a]));
    const selected = agentIds.map((id) => {
      const agent = byId.get(id);
      if (!agent) throw new NotFoundError(`Agent not found: ${id}`);
      return agent;
    });

    const disabled = selected.filter((a) => !a.enabled);
    if (disabled.length > 0) {
      throw new ValidationError(`Agent disabled: ${disabled.map((a) => a.name).join(', ')}`);
    }

    const reviewService = new ReviewService(this.container);
    const active = await reviewService.activeRuns(workspaceId, prId);
    const activeIds = new Set(active.map((r) => r.agent_id));
    const running = selected.filter((a) => activeIds.has(a.id));
    if (running.length > 0) {
      const names = running.map((a) => a.name);
      throw new AppError(
        'agents_already_running',
        `Already running: ${names.join(', ')}`,
        409,
        { agents: names },
      );
    }

    const multiRunId = await this.repo.createMultiRun(workspaceId, prId);
    // Sequential on purpose: runReview returns once its agent_runs row exists (the review
    // continues in the background), so reviews still run concurrently, and ran_at is strictly
    // increasing in selection order — the only order the DB can reproduce.
    const runIds: string[] = [];
    let lastError: unknown;
    for (const agent of selected) {
      try {
        const { runs } = await reviewService.runReview(workspaceId, prId, [agent], logger);
        for (const r of runs) runIds.push(r.run_id);
      } catch (err) {
        lastError = err;
        logger?.error({ prId, agentId: agent.id, err: (err as Error).message }, 'multi-agent: failed to start run');
      }
    }
    if (runIds.length === 0) {
      await this.repo.deleteMultiRun(workspaceId, multiRunId);
      throw lastError ?? new AppError('multi_agent_start_failed', 'No agent could be started', 500);
    }
    await this.repo.linkRuns(workspaceId, multiRunId, runIds);
    return this.getMultiRun(workspaceId, multiRunId);
  }

  /** The latest multi-run for a PR. 404 `no_multi_agent_run` when none (or all children were deleted). */
  async latestForPull(workspaceId: string, prId: string): Promise<MultiAgentRun> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const latest = await this.repo.latestMultiRunForPull(workspaceId, prId);
    if (!latest) throw this.noRun();
    return this.assemble(workspaceId, latest);
  }

  /** One enabled-agent entry per estimate, from each agent's latest done runs. */
  async estimates(workspaceId: string): Promise<AgentRunEstimate[]> {
    const agents = (await this.container.agentsRepo.list(workspaceId)).filter((a) => a.enabled);
    return Promise.all(
      agents.map(async (a) => {
        const runs = await this.repo.recentDoneRuns(workspaceId, a.id, ESTIMATE_SAMPLE);
        return {
          agent_id: a.id,
          est_duration_ms: median(runs.map((r) => r.durationMs).filter((v): v is number => v != null)),
          est_cost_usd: median(runs.map((r) => r.costUsd).filter((v): v is number => v != null)),
          sample_size: runs.length,
        };
      }),
    );
  }

  private noRun(): AppError {
    return new AppError('no_multi_agent_run', 'No multi-agent run for this pull request yet', 404);
  }

  private async getMultiRun(workspaceId: string, multiRunId: string): Promise<MultiAgentRun> {
    const meta = await this.repo.getMultiRun(workspaceId, multiRunId);
    if (!meta) throw this.noRun();
    return this.assemble(workspaceId, meta);
  }

  private async assemble(
    workspaceId: string,
    meta: { id: string; prId: string; prNumber: number | null; ranAt: string },
  ): Promise<MultiAgentRun> {
    const columns = await this.repo.columns(workspaceId, meta.id);
    if (columns.length === 0) throw this.noRun();
    return {
      id: meta.id,
      pr_id: meta.prId,
      pr_number: meta.prNumber,
      ran_at: meta.ranAt,
      agent_count: columns.length,
      ...deriveTotals(columns),
      columns,
      conflicts: groupFindings(columns),
    };
  }
}
