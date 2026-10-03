import type { ToolRegistrar } from '../deps.js';
import { registerGetBlastRadius } from './get-blast-radius.js';
import { registerGetConventions } from './get-conventions.js';
import { registerGetFindings } from './get-findings.js';
import { registerListAgents } from './list-agents.js';
import { registerRunAgentOnPr } from './run-agent-on-pr.js';

/** Fixed order = `tools/list` order (deterministic, cache-friendly). */
export const allTools: readonly ToolRegistrar[] = [
  registerListAgents,
  registerRunAgentOnPr,
  registerGetFindings,
  registerGetConventions,
  registerGetBlastRadius,
];
