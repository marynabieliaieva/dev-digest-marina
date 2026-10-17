// L06 gate: the eval pipeline's unit, parity and integration suites must all pass,
// and the integration suite must have actually executed (it skips silently, and
// reports green, when the Docker probe fails).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const UNIT_FILES = [
  'src/modules/eval/scoring.test.ts',
  'src/modules/eval/frozen-input.test.ts',
  'src/modules/eval/executor.test.ts',
  'test/eval-contract-parity.test.ts',
];
const IT_FILE = 'test/eval.it.test.ts';

function run(cmd) {
  // shell: true so `pnpm` resolves under cmd.exe on Windows.
  return spawnSync(cmd, { shell: true, stdio: 'inherit' }).status ?? 1;
}

const unit = run(`pnpm exec vitest run ${UNIT_FILES.join(' ')}`);
if (unit !== 0) {
  console.error('verify:l06: unit / parity suites failed');
  process.exit(unit);
}

// Run the .it suite alone: concurrent runs make the Docker probe time out.
const dir = mkdtempSync(join(tmpdir(), 'verify-l06-'));
const out = join(dir, 'it.json');
let code = 1;
try {
  const it = run(`pnpm exec vitest run ${IT_FILE} --reporter=json --outputFile="${out}"`);
  if (it !== 0) {
    console.error(`verify:l06: ${IT_FILE} failed`);
  } else {
    const report = JSON.parse(readFileSync(out, 'utf8'));
    const executed = (report.numPassedTests ?? 0) + (report.numFailedTests ?? 0);
    if (executed === 0) {
      console.error(`verify:l06: ${IT_FILE} executed 0 tests (skipped — is Docker running?)`);
    } else {
      console.log(`verify:l06: ok — ${IT_FILE} executed ${executed} test(s)`);
      code = 0;
    }
  }
} catch (err) {
  console.error(`verify:l06: could not read the ${IT_FILE} report: ${err.message}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
