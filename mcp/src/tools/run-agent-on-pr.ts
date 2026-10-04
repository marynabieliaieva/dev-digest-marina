import type { CallToolResult } from '@modelcontextprotocol/server';
import { ApiError } from '../api/client.js';
import type { ReviewByRefResponse, RunDetail } from '../api/types.js';
import type { ToolRegistrar } from '../deps.js';
import { DEFAULT_LIMIT, formatRunDetail, formatRunState } from '../format/findings.js';
import { apiErrorToTool } from '../lib/api-error.js';
import { advanceStatus, isTerminal } from '../lib/status.js';
import { toolError, toolText } from '../lib/tool-result.js';
import { RUN_AGENT_ON_PR_DESCRIPTION, RunAgentOnPrInput } from './run-agent-on-pr.schema.js';

export const TOOL_NAME = 'devdigest_run_agent_on_pr';

type StartedRun = ReviewByRefResponse['runs'][number];

/** A just-started run, before the first poll answers. */
function initialDetail(pr: ReviewByRefResponse['pr'], run: StartedRun): RunDetail {
  return {
    run: {
      run_id: run.run_id,
      status: 'running',
      error: null,
      agent_id: run.agent_id,
      agent_name: run.agent_name,
      model: null,
      ran_at: null,
      duration_ms: null,
      pr_number: pr.number,
      repo_full_name: pr.repo_full_name,
    },
    review: null,
  };
}

export const registerRunAgentOnPr: ToolRegistrar = (server, deps) => {
  const { api, config, clock } = deps;

  server.registerTool(
    TOOL_NAME,
    {
      title: 'Run reviewer agent on a PR',
      description: RUN_AGENT_ON_PR_DESCRIPTION,
      inputSchema: RunAgentOnPrInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args, ctx): Promise<CallToolResult> => {
      const signal = ctx.mcpReq.signal;
      const apiCtx = { apiUrl: config.apiUrl, action: 'running the review' };

      let started: ReviewByRefResponse;
      try {
        started = await api.reviewByRef(
          { repo: args.repo, pr: args.pr, agent: args.agent, all: args.all },
          { signal },
        );
      } catch (err) {
        return apiErrorToTool(err, apiCtx);
      }
      if (started.runs.length === 0) {
        return toolText(
          `No review run was started for ${args.repo}#${args.pr}. Pick an enabled agent via devdigest_list_agents.`,
        );
      }

      const deadline = clock.now() + config.runDeadlineMs;
      const details = new Map<string, RunDetail>(
        started.runs.map((r) => [r.run_id, initialDetail(started.pr, r)]),
      );
      const runIds = started.runs.map((r) => r.run_id);
      const pending = () => runIds.filter((id) => !isTerminal(details.get(id)!.run.status));

      const progressToken = ctx.mcpReq._meta?.progressToken;
      let tick = 0;
      const sendProgress = async () => {
        if (progressToken === undefined) return;
        tick += 1;
        const done = runIds.length - pending().length;
        try {
          await ctx.mcpReq.notify({
            method: 'notifications/progress',
            params: {
              progressToken,
              progress: tick,
              message: `${done}/${runIds.length} review run(s) finished`,
            },
          });
        } catch {
          // progress is best-effort; the client may be gone
        }
      };

      const pollOnce = async () => {
        for (const id of pending()) {
          const fresh = await api.getRun(id, { signal });
          const prev = details.get(id)!;
          // Statuses only move forward: ignore a stale response for a settled run.
          if (advanceStatus(prev.run.status, fresh.run.status) === fresh.run.status) {
            details.set(id, fresh);
          }
        }
      };

      let stopped = false;
      try {
        await sendProgress();
        await pollOnce();
        while (pending().length > 0) {
          if (signal.aborted) {
            stopped = true;
            break;
          }
          const remaining = deadline - clock.now();
          if (remaining <= 0) break;
          await sendProgress();
          await clock.sleep(Math.min(config.pollIntervalMs, remaining), signal);
          if (signal.aborted) {
            stopped = true;
            break;
          }
          await pollOnce();
        }
      } catch (err) {
        if (err instanceof ApiError && err.kind === 'aborted') {
          stopped = true;
        } else {
          const res = apiErrorToTool(err, { ...apiCtx, action: 'waiting for the review' });
          const first = res.content[0];
          const base = first && first.type === 'text' ? first.text : 'Failed while waiting for the review.';
          return toolError(
            `${base}\nThe review keeps running on the server. Run id(s): ${runIds.join(', ')}. Call devdigest_get_findings with a run_id later.`,
          );
        }
      }

      const fmt = { responseFormat: 'concise' as const, offset: 0, limit: DEFAULT_LIMIT };
      const blocks = runIds.map((id, i) => {
        const d = details.get(id)!;
        const note = started.runs[i]?.reused ? 'Reused an existing run for this PR and agent.\n' : '';
        return note + (isTerminal(d.run.status) ? formatRunDetail(d, fmt) : formatRunState(d));
      });
      const stillRunning = pending().length > 0;
      const prefix = stopped
        ? 'Stopped waiting (request cancelled); the review keeps running on the server.\n\n'
        : stillRunning
          ? `Still running after ${Math.round(config.runDeadlineMs / 1000)}s; the review keeps running on the server. Call devdigest_get_findings with the run_id below later.\n\n`
          : '';
      return toolText(prefix + blocks.join('\n\n'));
    },
  );
};
