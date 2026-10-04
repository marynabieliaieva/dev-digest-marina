import type { ToolRegistrar } from '../deps.js';
import type { ConventionCandidate } from '../api/types.js';
import { apiErrorToTool } from '../lib/api-error.js';
import { fence, truncate } from '../lib/fence.js';
import { toolText } from '../lib/tool-result.js';
import { getConventionsInput } from './get-conventions.schema.js';

export const GET_CONVENTIONS_DESCRIPTION =
  "Get the coding conventions extracted for a repository (rule, file, confidence, accepted). Use this to justify or check a finding against the repository's house rules.";

const RULE_MAX = 300;
const SNIPPET_MAX = 300;

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

function formatCandidate(c: ConventionCandidate, detailed: boolean): string {
  const loc = c.evidence_line != null ? `${c.evidence_path}:${c.evidence_line}` : c.evidence_path;
  const line = `- ${truncate(oneLine(c.rule), RULE_MAX)} (${loc}, confidence ${c.confidence.toFixed(2)}, ${
    c.status === 'accepted' ? 'accepted' : 'not accepted'
  })`;
  if (!detailed || !c.evidence_snippet) return line;
  return `${line}\n${fence(c.evidence_snippet, SNIPPET_MAX)}`;
}

export const registerGetConventions: ToolRegistrar = (server, deps) => {
  server.registerTool(
    'devdigest_get_conventions',
    {
      title: 'Get repository conventions',
      description: GET_CONVENTIONS_DESCRIPTION,
      inputSchema: getConventionsInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ repo, response_format }, ctx) => {
      const opts = { signal: ctx.mcpReq.signal };
      try {
        const resolved = await deps.api.resolveRepo(repo, opts);
        const page = await deps.api.getConventions(resolved.id, opts);
        if (!page.extraction || page.candidates.length === 0) {
          return toolText(
            `No conventions found for ${resolved.full_name}: no convention scan has produced results yet. Run a convention scan for this repo in the DevDigest UI, then call devdigest_get_conventions again.`,
          );
        }
        const detailed = response_format === 'detailed';
        const accepted = page.candidates.filter((c) => c.status === 'accepted').length;
        const lines = [
          `Conventions for ${resolved.full_name} — ${page.candidates.length} total, ${accepted} accepted (scan ${page.extraction.status}).`,
          ...page.candidates.map((c) => formatCandidate(c, detailed)),
        ];
        if (!detailed) lines.push("response_format:'detailed' adds the evidence snippet.");
        return toolText(lines.join('\n'));
      } catch (err) {
        return apiErrorToTool(err, { apiUrl: deps.config.apiUrl, action: 'fetching conventions' });
      }
    },
  );
};
