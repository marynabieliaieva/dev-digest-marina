/**
 * CI change detector for the harness evals.
 *
 * Reads a newline-separated list of changed files (repo-relative) from $CHANGED_FILES and maps
 * them onto the eval suites that should run for this PR:
 *
 *   .claude/skills/<name>/**   OR  evals/skills/<name>/**   → run evals/skills/<name>  (content tier)
 *   .claude/agents/<name>.md   OR  evals/agents/<name>/**   → run evals/agents/<name>  (tool tier)
 *   CLAUDE.md / .claude/CLAUDE.md / any agent / engine change → run the workflow tier
 *
 * A changed artifact with NO written evals is NOT a failure: it is reported on the `skipped_*`
 * outputs so the job can print a visible "SKIP <name> (no evals)" line instead of going red.
 *
 * Emits GitHub Actions step outputs (skills, agents, run_workflow, skipped_skills, skipped_agents)
 * to $GITHUB_OUTPUT. Pure filesystem + string work — no deps.
 */

import { existsSync, readdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const EVALS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(EVALS_DIR, "..");

const changed = (process.env.CHANGED_FILES ?? "")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

/** Does evals/<tier>/<name>/ contain at least one *.eval.ts? */
function hasEvals(tier, name) {
  const dir = join(EVALS_DIR, tier, name);
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => f.endsWith(".eval.ts"));
}

/** Names end up in matrix values and shell commands downstream — accept plain slugs only. */
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
/** `*-lite` artifacts are deliberately weakened A/B controls: their evals are EXPECTED to fail. */
const isControlVariant = (n) => n.endsWith("-lite");

/** Collect distinct artifact names touched under a `.claude` and/or `evals` prefix. */
function touched(reClaude, reEvals) {
  const names = new Set();
  for (const f of changed) {
    const m = f.match(reClaude) ?? f.match(reEvals);
    if (m && SAFE_NAME.test(m[1])) names.add(m[1]);
  }
  return [...names].sort();
}

const skillNames = touched(
  /^\.claude\/skills\/([^/]+)\//,
  /^evals\/skills\/([^/]+)\//,
);
const agentNames = touched(
  /^\.claude\/agents\/([^/]+)\.md$/,
  /^evals\/agents\/([^/]+)\//,
);

const controlSkills = skillNames.filter(isControlVariant);
const controlAgents = agentNames.filter(isControlVariant);
const realSkills = skillNames.filter((n) => !isControlVariant(n));
const realAgents = agentNames.filter((n) => !isControlVariant(n));

const skills = realSkills.filter((n) => hasEvals("skills", n));
const skippedSkills = realSkills.filter((n) => !hasEvals("skills", n));
const agents = realAgents.filter((n) => hasEvals("agents", n));
const skippedAgents = realAgents.filter((n) => !hasEvals("agents", n));

// The workflow tier measures the LIVE harness, so anything that changes it re-triggers it:
// any CLAUDE.md / AGENTS.md (root, .claude or a package — a package CLAUDE.md is just `@AGENTS.md`,
// the real rules live in AGENTS.md), any real agent definition, the workflow cases, the engine.
const agentDef = /^\.claude\/agents\/([^/]+)\.md$/;
const runWorkflow = changed.some(
  (f) =>
    /(^|\/)(CLAUDE|AGENTS)\.md$/.test(f) ||
    (agentDef.test(f) && !isControlVariant(f.match(agentDef)[1])) ||
    /^evals\/workflow\//.test(f) ||
    /^evals\/src\//.test(f),
);

const out = process.env.GITHUB_OUTPUT;
const write = (k, v) => (out ? appendFileSync(out, `${k}=${v}\n`) : console.log(`${k}=${v}`));

write("skills", JSON.stringify(skills));
write("agents", JSON.stringify(agents));
write("run_workflow", String(runWorkflow));
write("skipped_skills", skippedSkills.join(" "));
write("skipped_agents", skippedAgents.join(" "));

// Human-readable summary in the step log.
console.error("── eval change detection ──");
console.error(`changed files : ${changed.length}`);
console.error(`skills → run  : ${skills.join(", ") || "(none)"}`);
console.error(`agents → run  : ${agents.join(", ") || "(none)"}`);
console.error(`workflow tier : ${runWorkflow ? "run" : "skip"}`);
if (skippedSkills.length) console.error(`SKIP skills (no evals): ${skippedSkills.join(", ")}`);
if (skippedAgents.length) console.error(`SKIP agents (no evals): ${skippedAgents.join(", ")}`);
const controls = [...controlSkills, ...controlAgents];
if (controls.length) console.error(`SKIP eval-only control variants: ${controls.join(", ")}`);

// The same report as a table on the workflow run page ($GITHUB_STEP_SUMMARY).
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (summaryFile) {
  const row = (kind, name, action) => `| ${kind} | \`${name}\` | ${action} |`;
  const rows = [
    ...skills.map((n) => row("skill", n, "▶️ run")),
    ...skippedSkills.map((n) => row("skill", n, "⏭️ SKIP — no evals written")),
    ...agents.map((n) => row("agent", n, "▶️ run")),
    ...skippedAgents.map((n) => row("agent", n, "⏭️ SKIP — no evals written")),
    ...controls.map((n) => row("control", n, "⏭️ SKIP — eval-only variant")),
    `| workflow | harness | ${runWorkflow ? "▶️ run" : "⏭️ SKIP — no harness files changed"} |`,
  ];
  appendFileSync(
    summaryFile,
    `### Eval selection\n\n| Kind | Name | Action |\n|---|---|---|\n${rows.join("\n")}\n`,
  );
}
