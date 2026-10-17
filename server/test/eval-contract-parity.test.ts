import { describe, it, expect } from 'vitest';
import * as serverEval from '../src/vendor/shared/contracts/eval-ci.js';
import * as serverKnowledge from '../src/vendor/shared/contracts/knowledge.js';
import * as serverReview from '../src/vendor/shared/contracts/review-api.js';
import * as clientEval from '../../client/src/vendor/shared/contracts/eval-ci.js';
import * as clientKnowledge from '../../client/src/vendor/shared/contracts/knowledge.js';
import * as clientReview from '../../client/src/vendor/shared/contracts/review-api.js';

/**
 * AC-69: the server and client copies of the eval contracts are maintained by
 * hand. Every eval schema must accept and reject the same payloads on both
 * sides, so drift (a field type changed on one side) fails here.
 */

type Schema = { safeParse: (v: unknown) => { success: boolean } };
const pick = (mod: Record<string, unknown>, name: string): Schema => mod[name] as Schema;

const batch = {
  id: 'b1',
  agent_id: 'a1',
  agent_name: 'Security Agent',
  scope: 'set',
  agent_version: 2,
  status: 'done',
  error: null,
  started_at: '2026-10-15T10:00:00.000Z',
  finished_at: '2026-10-15T10:01:00.000Z',
  cases_total: 3,
  cases_done: 3,
  traces_passed: 2,
  traces_total: 3,
  recall: 0.5,
  precision: 1,
  citation_accuracy: 0.9,
  cost_usd: 0.01,
  duration_ms: 60000,
};
const snapshot = {
  provider: 'openai',
  model: 'gpt-4.1',
  system_prompt: 'Review.',
  strategy: 'single-pass',
  skills: [{ name: 's', body: 'b' }],
};
const run = {
  id: 'r1',
  case_id: 'c1',
  batch_id: 'b1',
  error: null,
  ran_at: '2026-10-15T10:00:30.000Z',
  actual_output: { findings: [] },
  pass: true,
  recall: 1,
  precision: 1,
  citation_accuracy: 1,
  duration_ms: 10,
  cost_usd: null,
};
const expectation = {
  type: 'must_find',
  file: 'src/a.ts',
  start_line: 1,
  end_line: 2,
  kind: 'finding',
  severity: 'CRITICAL',
  category: 'security',
  title: 'T',
  source_finding_id: 'f1',
};
const finding = {
  id: 'f1',
  severity: 'CRITICAL',
  category: 'security',
  title: 'T',
  file: 'src/a.ts',
  start_line: 1,
  end_line: 2,
  rationale: 'r',
  confidence: 0.9,
};
const trend = {
  batch_id: 'b1',
  agent_version: 1,
  ran_at: '2026-10-15T10:00:00.000Z',
  recall: 0.5,
  precision: null,
  citation_accuracy: 1,
  pass_rate: 0.5,
  cost_usd: null,
};
const caseDto = {
  id: 'c1',
  owner_kind: 'agent',
  owner_id: 'a1',
  name: 'n',
  input_diff: '',
  input_files: null,
  input_meta: null,
  expected_output: expectation,
  source_finding_id: 'f1',
  created_at: '2026-10-15T10:00:00.000Z',
  expectation,
  last_result: null,
};
const dashboard = {
  owner_kind: 'agent',
  owner_id: 'a1',
  cases_total: 3,
  current: { recall: 1, precision: 1, citation_accuracy: 1, traces_passed: 3, traces_total: 3, cost_usd: null },
  delta: { recall: null, precision: 0.1, citation_accuracy: null },
  trend: [trend],
  recent_runs: [run],
  recent_batches: [batch],
  running_batch_id: null,
  alert: null,
};
const summary = {
  agent_id: 'a1',
  agent_name: 'A',
  model: 'gpt-4.1',
  enabled: true,
  cases_total: 1,
  last_batch: batch,
  sparkline: [0.5, 1],
  running_batch_id: null,
};
const compare = {
  base: batch,
  head: batch,
  delta: { recall: 0, precision: null, citation_accuracy: 0, cost_usd: null },
  prompt_diff: [{ op: 'same', text: 'x' }],
  model_changed: false,
};

/** schema name -> [valid fixtures, invalid fixtures] */
const FIXTURES: Record<string, { valid: unknown[]; invalid: unknown[] }> = {
  EvalExpectation: {
    valid: [expectation],
    invalid: [{ ...expectation, type: 'maybe' }, { ...expectation, start_line: '1' }, {}],
  },
  EvalCaseLastResult: {
    valid: [{ pass: null, error: 'x', ran_at: 't', actual_count: 0, matched_count: 0 }],
    invalid: [{ pass: 'yes', error: null, ran_at: 't', actual_count: 0, matched_count: 0 }],
  },
  EvalCaseDto: {
    valid: [
      caseDto,
      { ...caseDto, last_result: { pass: true, error: null, ran_at: 't', actual_count: 1, matched_count: 1 } },
    ],
    invalid: [{ ...caseDto, expectation: undefined }, { ...caseDto, created_at: 1 }],
  },
  EvalBatchStatus: { valid: ['running', 'done', 'failed'], invalid: ['queued', 1] },
  EvalBatchScope: { valid: ['set', 'case'], invalid: ['all'] },
  EvalConfigSnapshot: {
    valid: [snapshot, { ...snapshot, skills: [] }],
    invalid: [{ ...snapshot, skills: [{ name: 's' }] }, { ...snapshot, model: 1 }],
  },
  EvalBatch: {
    valid: [batch, { ...batch, recall: null, config_snapshot: snapshot }],
    invalid: [{ ...batch, scope: 'x' }, { ...batch, agent_version: 1.5 }, { ...batch, error: undefined }],
  },
  EvalRunRecord: {
    valid: [run, { ...run, case_name: null, pass: null }],
    invalid: [{ ...run, batch_id: undefined }, { ...run, duration_ms: 1.5 }],
  },
  EvalBatchDetail: {
    valid: [{ ...batch, runs: [run], config_snapshot: snapshot }],
    invalid: [{ ...batch, runs: [run] }, { ...batch, runs: [{}], config_snapshot: snapshot }],
  },
  EvalActualOutput: {
    valid: [{ findings: [finding], dropped: [{ finding, reason: 'x' }], matched_finding_ids: ['f1'] }],
    invalid: [{ findings: [finding], dropped: [{ reason: 'x' }], matched_finding_ids: [] }],
  },
  EvalRunStarted: { valid: [{ batch_id: 'b' }], invalid: [{}, { batch_id: 1 }] },
  EvalRunAllResult: {
    valid: [{ started: [{ agent_id: 'a', batch_id: 'b' }], skipped: [{ agent_id: 'a', reason: 'no_cases' }] }],
    invalid: [{ started: [], skipped: [{ agent_id: 'a', reason: 'nope' }] }],
  },
  EvalTrendPoint: {
    valid: [trend],
    invalid: [{ ...trend, pass_rate: null }, { ...trend, batch_id: undefined }],
  },
  EvalDashboard: {
    valid: [dashboard, { ...dashboard, current: null }],
    invalid: [{ ...dashboard, running_batch_id: undefined }, { ...dashboard, trend: [{}] }],
  },
  AgentEvalSummary: {
    valid: [summary, { ...summary, last_batch: null }],
    invalid: [{ ...summary, sparkline: ['x'] }, { ...summary, enabled: 'yes' }],
  },
  EvalWorkspaceDashboard: {
    valid: [{ agents: [summary], recent_batches: [batch] }],
    invalid: [{ agents: [summary] }],
  },
  EvalCompare: {
    valid: [compare],
    invalid: [{ ...compare, prompt_diff: [{ op: 'mod', text: 'x' }] }, { ...compare, model_changed: 'no' }],
  },
};

describe('eval contract parity (server vs client mirror)', () => {
  for (const [name, { valid, invalid }] of Object.entries(FIXTURES)) {
    it(`${name} exists on both sides and agrees on every fixture`, () => {
      const server = pick(serverEval, name);
      const client = pick(clientEval, name);
      expect(server, `server is missing ${name}`).toBeDefined();
      expect(client, `client mirror is missing ${name}`).toBeDefined();

      for (const f of valid) {
        expect(server.safeParse(f).success, `server should accept valid ${name} fixture`).toBe(true);
        expect(client.safeParse(f).success, `client should accept valid ${name} fixture`).toBe(true);
      }
      for (const f of invalid) {
        expect(server.safeParse(f).success, `server should reject invalid ${name} fixture`).toBe(false);
        expect(client.safeParse(f).success, `client should reject invalid ${name} fixture`).toBe(false);
      }
    });
  }

  it('EvalCase and EvalRun (knowledge.ts) agree on both sides', () => {
    const evalCase = { id: 'c', owner_kind: 'agent', owner_id: 'a', name: 'n', input_diff: '', input_files: null, input_meta: null, expected_output: {} };
    for (const [name, valid, invalid] of [
      ['EvalCase', evalCase, { ...evalCase, owner_kind: 'team' }],
      [
        'EvalRun',
        { recall: 1, precision: 1, citation_accuracy: 1, traces_passed: 1, traces_total: 1, duration_ms: 1, cost_usd: null, per_trace: [] },
        { recall: 2, precision: 1, citation_accuracy: 1, traces_passed: 1, traces_total: 1, duration_ms: 1, cost_usd: null, per_trace: [] },
      ],
    ] as const) {
      expect(pick(serverKnowledge, name).safeParse(valid).success).toBe(true);
      expect(pick(clientKnowledge, name).safeParse(valid).success).toBe(true);
      expect(pick(serverKnowledge, name).safeParse(invalid).success).toBe(false);
      expect(pick(clientKnowledge, name).safeParse(invalid).success).toBe(false);
    }
  });

  it('FindingRecord accepts eval_case_id (string, null, absent) and rejects a number on both sides', () => {
    const rec = { ...finding, review_id: 'r1', accepted_at: null, dismissed_at: null };
    const server = pick(serverReview, 'FindingRecord');
    const client = pick(clientReview, 'FindingRecord');
    for (const s of [server, client]) {
      expect(s.safeParse(rec).success).toBe(true);
      expect(s.safeParse({ ...rec, eval_case_id: 'c1' }).success).toBe(true);
      expect(s.safeParse({ ...rec, eval_case_id: null }).success).toBe(true);
      expect(s.safeParse({ ...rec, eval_case_id: 5 }).success).toBe(false);
    }
  });
});
