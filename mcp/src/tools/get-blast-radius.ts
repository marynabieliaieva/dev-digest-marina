import type { ToolRegistrar } from '../deps.js';
import { formatBlast } from '../format/blast.js';
import { apiErrorToTool } from '../lib/api-error.js';
import { capResponse } from '../lib/cap.js';
import { toolError, toolText } from '../lib/tool-result.js';
import { BLAST_RADIUS_DESCRIPTION, getBlastRadiusInput } from './get-blast-radius.schema.js';

export const registerGetBlastRadius: ToolRegistrar = (server, deps) => {
  server.registerTool(
    'devdigest_get_blast_radius',
    {
      title: 'Get blast radius',
      description: BLAST_RADIUS_DESCRIPTION,
      inputSchema: getBlastRadiusInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args, ctx) => {
      const { repo, pr } = args;
      if (!repo || pr === undefined) {
        return toolError('Provide both repo (owner/name) and pr (number).');
      }
      const signal = ctx.mcpReq.signal;
      try {
        const ref = await deps.api.resolvePull(repo, pr, { signal });
        const resp = await deps.api.getBlast(ref.id, { signal });
        return toolText(capResponse(formatBlast(resp, { repo, pr })));
      } catch (err) {
        return apiErrorToTool(err, { apiUrl: deps.config.apiUrl, action: 'reading the blast radius' });
      }
    },
  );
};
