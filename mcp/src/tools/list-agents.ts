import type { ToolRegistrar } from '../deps.js';
import type { AgentSummary } from '../api/types.js';
import { apiErrorToTool } from '../lib/api-error.js';
import { truncate } from '../lib/fence.js';
import { toolText } from '../lib/tool-result.js';
import { listAgentsInput } from './list-agents.schema.js';

export const LIST_AGENTS_DESCRIPTION =
  'List the reviewer agents configured in DevDigest (id, name, model, enabled). Call this first to get a valid agent id for devdigest_run_agent_on_pr — do not guess or invent agent ids.';

const DESCRIPTION_MAX = 100;

/** Enabled agents first; otherwise keep the API order (stable sort). */
export function sortAgents(agents: AgentSummary[]): AgentSummary[] {
  return [...agents].sort((a, b) => Number(b.enabled) - Number(a.enabled));
}

export function formatAgentLine(a: AgentSummary): string {
  const desc = truncate(a.description.replace(/\s+/g, ' ').trim(), DESCRIPTION_MAX);
  const head = `${a.name} · ${a.id} · ${a.model} · ${a.enabled ? 'enabled' : 'disabled'}`;
  return desc ? `${head} — ${desc}` : head;
}

export const registerListAgents: ToolRegistrar = (server, deps) => {
  server.registerTool(
    'devdigest_list_agents',
    {
      title: 'List reviewer agents',
      description: LIST_AGENTS_DESCRIPTION,
      inputSchema: listAgentsInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (_args, ctx) => {
      try {
        const agents = sortAgents(await deps.api.listAgents({ signal: ctx.mcpReq.signal }));
        if (agents.length === 0) {
          return toolText('No reviewer agents are configured in DevDigest. Create one in the DevDigest UI, then call devdigest_list_agents again.');
        }
        const header = 'name · id · model · status — description';
        return toolText([header, ...agents.map(formatAgentLine)].join('\n'));
      } catch (err) {
        return apiErrorToTool(err, { apiUrl: deps.config.apiUrl, action: 'listing agents' });
      }
    },
  );
};
