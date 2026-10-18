import { describe, expect, it } from 'vitest';
import { buildGhaWorkflowYaml } from './workflow.js';
import { validateWorkflow } from './workflow-validate.js';

const rules = (src: string) => validateWorkflow(src).map((v) => v.rule);

describe('generated workflow', () => {
  it('passes its own validation for every trigger combination', () => {
    for (const triggers of [['opened'], ['opened', 'synchronize'], ['opened', 'synchronize', 'reopened']]) {
      expect(validateWorkflow(buildGhaWorkflowYaml({ triggers }))).toEqual([]);
    }
  });

  it('pins every `uses:` to a 40-char SHA with a version comment (W4)', () => {
    const uses = buildGhaWorkflowYaml()
      .split('\n')
      .filter((l) => l.includes('uses:'));
    expect(uses.length).toBe(3);
    for (const line of uses) expect(line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d/);
  });

  it('checks out without persisting credentials', () => {
    expect(buildGhaWorkflowYaml()).toContain('persist-credentials: false');
  });
});

describe('validateWorkflow — edited workflow rules', () => {
  const base = buildGhaWorkflowYaml();

  it('W1: rejects pull_request_target', () => {
    expect(rules(base.replace('pull_request:', 'pull_request_target:'))).toContain('W1');
  });

  it('W1: rejects an extra trigger (push) and inline forms', () => {
    expect(rules(base.replace('on:\n  pull_request:', 'on:\n  push:\n  pull_request:'))).toContain('W1');
    expect(rules('on: [pull_request, workflow_run]\npermissions:\n  contents: read\n  pull-requests: write\n')).toContain('W1');
    expect(rules('on: issue_comment\npermissions:\n  contents: read\n  pull-requests: write\n')).toContain('W1');
  });

  it('W2: rejects broader or missing permissions', () => {
    expect(rules(base.replace('contents: read', 'contents: write'))).toContain('W2');
    expect(rules(base.replace('permissions:\n  contents: read\n  pull-requests: write\n', ''))).toContain('W2');
    expect(rules(base.replace('permissions:\n', 'permissions: write-all\n#'))).toContain('W2');
    expect(rules(base.replace('  pull-requests: write\n', '  pull-requests: write\n  id-token: write\n'))).toContain('W2');
  });

  it('W2: rejects a job-level permission grant broader than allowed', () => {
    const edited = base.replace('    runs-on: ubuntu-latest', '    permissions:\n      contents: write\n    runs-on: ubuntu-latest');
    expect(rules(edited)).toContain('W2');
  });

  it('W4: rejects tag and branch refs but allows SHA pins', () => {
    const unpinned = base.replace(/actions\/checkout@[0-9a-f]{40} # v[\d.]+/, 'actions/checkout@v4');
    const v = validateWorkflow(unpinned);
    expect(v.map((x) => x.rule)).toEqual(['W4']);
    expect(v[0]!.line).toBeGreaterThan(0);
    expect(rules(base.replace(/actions\/setup-node@[0-9a-f]{40}/, 'actions/setup-node@main'))).toContain('W4');
  });

  it('W7: rejects untrusted expressions inside run scripts (inline and block)', () => {
    const inline = base + '      - run: echo "${{ github.event.pull_request.title }}"\n';
    expect(rules(inline)).toContain('W7');
    const block = base + '      - name: x\n        run: |\n          echo ${{ github.head_ref }}\n';
    expect(rules(block)).toContain('W7');
  });

  it('W7: allows the same expression passed through env:', () => {
    const ok = base.replace('run: node .devdigest/runner/index.js', 'run: node .devdigest/runner/index.js\n        # title via env only');
    expect(rules(ok)).toEqual([]);
  });

  it('rejects empty and tab-indented YAML with a line number', () => {
    expect(validateWorkflow('   \n')[0]!.rule).toBe('YAML');
    const tabbed = validateWorkflow('on:\n\tpull_request:\n');
    expect(tabbed[0]).toMatchObject({ rule: 'YAML', line: 2 });
  });
});
