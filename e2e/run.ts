/**
 * DevDigest web e2e runner — Vercel agent-browser, deterministic, no LLM.
 *
 * agent-browser is a CDP browser-automation CLI (not a test framework), so we
 * define a thin convention: each flow is a `specs/*.flow.json` file listing
 * agent-browser commands. Commands share one browser session (the daemon keeps
 * the page between invocations). A command that exits non-zero — including a
 * `wait --text` / `wait --url` whose condition never holds — fails the step and
 * the flow. We add only light substring checks on top.
 *
 * Env:
 *   E2E_BASE_URL       web app origin (default http://localhost:3000)
 *   AGENT_BROWSER_BIN  binary name/path (default "agent-browser")
 *   E2E_STEP_TIMEOUT   per-command timeout in ms (default 60000)
 *
 * Specs target read-only seeded data, so nothing here triggers an LLM call or
 * needs an API key. Run order is the lexical order of the spec filenames.
 */
import spawn from "cross-spawn";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  resolveArgs,
  stdoutContains,
  summarize,
  type Flow,
  type FlowResult,
  type StepResult,
} from "./lib/assert.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPECS_DIR = join(HERE, "specs");
const RESULTS_DIR = join(HERE, "test-results");

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const BIN = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
const STEP_TIMEOUT = Number(process.env.E2E_STEP_TIMEOUT ?? 60_000);

/**
 * Run one agent-browser command; resolve with its stdout, reject on non-zero
 * exit. Uses cross-spawn instead of node:child_process directly — on Windows
 * agent-browser resolves to an npm-generated `.cmd` shim, which Windows'
 * CreateProcess cannot launch without a shell, and plain `execFile(..., {
 * shell: true })` joins array args with spaces unquoted, splitting any
 * argument that contains a space (most of our `wait --text "..."` labels).
 * cross-spawn resolves the shim and quotes each arg correctly either way.
 */
async function ab(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, args, { cwd: HERE });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${BIN} ${args.join(" ")} timed out after ${STEP_TIMEOUT}ms`));
    }, STEP_TIMEOUT);
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${BIN} ${args.join(" ")} exited ${code}: ${stderr || stdout}`));
    });
  });
}

function loadFlows(): { file: string; flow: Flow }[] {
  return readdirSync(SPECS_DIR)
    .filter((f) => f.endsWith(".flow.json"))
    .sort()
    .map((file) => ({
      file,
      flow: JSON.parse(readFileSync(join(SPECS_DIR, file), "utf8")) as Flow,
    }));
}

async function runFlow(file: string, flow: Flow): Promise<FlowResult> {
  const id = file.replace(/\.flow\.json$/, "");
  console.log(`\n▶ ${flow.name}  (${file})`);
  const steps: StepResult[] = [];

  for (const step of flow.steps) {
    const args = resolveArgs(step.cmd, BASE);
    const label = step.label ?? args.join(" ");
    try {
      const stdout = await ab(args);
      if (step.assert?.stdoutIncludes && !stdoutContains(stdout, step.assert.stdoutIncludes)) {
        steps.push({ label, ok: false, detail: `stdout missing "${step.assert.stdoutIncludes}"` });
        console.log(`   ✗ ${label} — assertion failed`);
        break;
      }
      steps.push({ label, ok: true });
      console.log(`   ✓ ${label}`);
    } catch (e) {
      const msg = (e as Error).message.split("\n")[0];
      steps.push({ label, ok: false, detail: msg });
      console.log(`   ✗ ${label} — ${msg}`);
      // Best-effort failure screenshot for the artifact upload.
      mkdirSync(RESULTS_DIR, { recursive: true });
      await ab(["screenshot", join(RESULTS_DIR, `${id}-fail.png`)]).catch(() => {});
      break;
    }
  }

  const ok = steps.every((s) => s.ok);
  return { name: flow.name, ok, steps };
}

async function main(): Promise<void> {
  console.log(`DevDigest e2e — base=${BASE} bin=${BIN}`);
  const flows = loadFlows();
  if (flows.length === 0) {
    console.error(`No specs found in ${SPECS_DIR}`);
    process.exit(1);
  }

  const results: FlowResult[] = [];
  try {
    for (const { file, flow } of flows) {
      results.push(await runFlow(file, flow));
    }
  } finally {
    // Tear down the shared browser session regardless of outcome.
    await ab(["close"]).catch(() => {});
  }

  console.log(`\n${summarize(results)}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((e) => {
  console.error(`e2e runner crashed: ${(e as Error).message}`);
  process.exit(1);
});
