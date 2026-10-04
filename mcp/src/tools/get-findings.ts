import type { RunDetail } from '../api/types.js';
import type { ToolRegistrar } from '../deps.js';
import { formatRunDetail, formatRunDetails } from '../format/findings.js';
import { apiErrorToTool } from '../lib/api-error.js';
import { toolError, toolText } from '../lib/tool-result.js';
import { GET_FINDINGS_DESCRIPTION, GetFindingsInput } from './get-findings.schema.js';

export const TOOL_NAME = 'devdigest_get_findings';

export const registerGetFindings: ToolRegistrar = (server, deps) => {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Get review findings',
      description: GET_FINDINGS_DESCRIPTION,
      inputSchema: GetFindingsInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, ctx) => {
      const signal = ctx.mcpReq.signal;
      const fmt = {
        responseFormat: args.response_format,
        severity: args.severity,
        file: args.file,
        offset: args.offset,
        limit: args.limit,
      };
      try {
        if (args.run_id) {
          const detail = await deps.api.getRun(args.run_id, { signal });
          const { repo_full_name: repo, pr_number: pr, agent_id: agentId } = detail.run;
          if (repo === null || pr === null) return toolText(formatRunDetail(detail, fmt));
          // Whole-PR picture: the requested run replaces its agent's latest one,
          // every other agent contributes its latest review. Best-effort — if the
          // lookup fails the single run is still a valid answer.
          let latest: RunDetail[];
          try {
            latest = await deps.api.latestReview(repo, pr, { signal });
          } catch {
            return toolText(formatRunDetail(detail, fmt));
          }
          const others = latest.filter((d) => d.run.run_id !== detail.run.run_id && d.run.agent_id !== agentId);
          return toolText(formatRunDetails([detail, ...others], fmt));
        }
        if (args.repo && args.pr !== undefined) {
          const details = await deps.api.latestReview(args.repo, args.pr, { signal });
          if (details.length === 0) {
            return toolText(
              `No review runs found for ${args.repo}#${args.pr}. Start one with devdigest_run_agent_on_pr.`,
            );
          }
          return toolText(formatRunDetails(details, fmt));
        }
        return toolError(
          'Provide either run_id (from devdigest_run_agent_on_pr), or both repo (owner/name) and pr (number).',
        );
      } catch (err) {
        return apiErrorToTool(err, { apiUrl: deps.config.apiUrl, action: 'reading findings' });
      }
    },
  );
};
