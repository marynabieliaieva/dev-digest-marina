/**
 * Starter findings for building each built-in agent's eval set (lesson 06).
 *
 * They are seeded UNDECIDED. Opening a finding in the PR view and pressing
 * Accept (→ a `must_find` case) or Dismiss (→ `must_not_flag`) is what makes
 * it eligible for "add to eval set". `verdict` + `why` below are the answer key
 * for which button to press — they are not written to the DB.
 *
 * All findings anchor to the control PRs (#483–#485) because those are the
 * only seeded PRs that carry real `patch` text, so the case can freeze a diff.
 * Line numbers are on the new side of each patch.
 */

export type SeedEvalAgent =
  | 'General Reviewer'
  | 'Security Reviewer'
  | 'Performance Reviewer'
  | 'Test Quality Reviewer'
  | 'API Contract Reviewer';

export interface SeedEvalFinding {
  agent: SeedEvalAgent;
  pr: 483 | 484 | 485;
  file: string;
  startLine: number;
  endLine: number;
  severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
  category: string;
  title: string;
  rationale: string;
  suggestion: string | null;
  confidence: number;
  /** accept → must_find, dismiss → must_not_flag */
  verdict: 'accept' | 'dismiss';
  /** Why that verdict is right, for whoever presses the button. */
  why: string;
}

const REFUND = 'src/payments/refund.ts';
const REFUND_TEST = 'src/payments/refund.test.ts';
const ROUTES = 'src/api/payments/routes.ts';
const SERVICE = 'src/api/payments/service.ts';
const LIST = 'src/api/payments/list.ts';

export const SEED_EVAL_FINDINGS: SeedEvalFinding[] = [
  // ============================================================ General Reviewer
  {
    agent: 'General Reviewer', pr: 483, file: REFUND, startLine: 16, endLine: 18,
    severity: 'WARNING', category: 'bug', confidence: 0.84, verdict: 'accept',
    title: 'Refund limit ignores amounts already refunded',
    rationale: 'The range check compares only against `payment.amount`. A payment refunded in part can be refunded again for the full amount, so total refunds can exceed what was captured.',
    suggestion: 'Track the refunded total and validate `amount <= payment.amount - alreadyRefunded`.',
    why: 'Real bug visible in the diff: the check uses the original amount only.',
  },
  {
    agent: 'General Reviewer', pr: 483, file: REFUND, startLine: 24, endLine: 24,
    severity: 'WARNING', category: 'bug', confidence: 0.78, verdict: 'accept',
    title: 'MAX_PARTIAL_REFUNDS is exported but never enforced',
    rationale: '`refundPayment` never reads `MAX_PARTIAL_REFUNDS`, so the documented cap of five partial refunds does nothing.',
    suggestion: 'Count existing refunds in `refundPayment` and reject once the cap is reached.',
    why: 'Dead constant: nothing in the diff uses it.',
  },
  {
    agent: 'General Reviewer', pr: 484, file: ROUTES, startLine: 14, endLine: 14,
    severity: 'CRITICAL', category: 'bug', confidence: 0.9, verdict: 'accept',
    title: '`currency` changes from optional to required',
    rationale: 'Clients that omit `currency` used to get `USD`. The schema now rejects them with a 400, which the PR description calls "no functional change".',
    suggestion: 'Keep `.default("USD")` or ship the change behind a new API version.',
    why: 'Real regression for existing callers.',
  },
  {
    agent: 'General Reviewer', pr: 485, file: LIST, startLine: 4, endLine: 4,
    severity: 'CRITICAL', category: 'bug', confidence: 0.9, verdict: 'accept',
    title: '`status` query param is now required',
    rationale: 'Removing `.optional()` makes `GET /payments` without `status` fail validation. Existing clients that list all payments break.',
    suggestion: 'Restore `.optional()`.',
    why: 'Real regression; contradicts "no behavior change".',
  },
  {
    agent: 'General Reviewer', pr: 485, file: LIST, startLine: 14, endLine: 14,
    severity: 'WARNING', category: 'bug', confidence: 0.88, verdict: 'accept',
    title: 'Response field `total` renamed to `count`',
    rationale: 'Any client reading `total` now gets `undefined`. The rename is not mentioned as breaking.',
    suggestion: 'Return both fields during a deprecation window.',
    why: 'Real breaking rename.',
  },
  {
    agent: 'General Reviewer', pr: 483, file: REFUND, startLine: 1, endLine: 1,
    severity: 'SUGGESTION', category: 'clarity', confidence: 0.55, verdict: 'dismiss',
    title: 'Unused import `createRefund`',
    rationale: '`createRefund` is imported but does not appear to be used in the function body.',
    suggestion: 'Remove the unused import.',
    why: 'False positive: `createRefund` is called on line 20.',
  },
  {
    agent: 'General Reviewer', pr: 485, file: LIST, startLine: 5, endLine: 5,
    severity: 'WARNING', category: 'bug', confidence: 0.6, verdict: 'dismiss',
    title: '`limit` has no upper bound',
    rationale: 'A client can request an arbitrarily large page, which could return the entire table.',
    suggestion: 'Add `.max(100)`.',
    why: 'False positive: `.max(100)` is already there.',
  },
  {
    agent: 'General Reviewer', pr: 483, file: REFUND_TEST, startLine: 4, endLine: 7,
    severity: 'WARNING', category: 'bug', confidence: 0.5, verdict: 'dismiss',
    title: '`vi.mock` runs after the import so the mock is ignored',
    rationale: 'The `refundPayment` import is above `vi.mock`, so the real gateway would be loaded first.',
    suggestion: 'Move `vi.mock` above the import.',
    why: 'False positive: vitest hoists `vi.mock` automatically.',
  },

  // ============================================================ Security Reviewer
  {
    agent: 'Security Reviewer', pr: 483, file: REFUND, startLine: 16, endLine: 18,
    severity: 'CRITICAL', category: 'security', confidence: 0.82, verdict: 'accept',
    title: 'NaN amount bypasses the refund range check',
    rationale: '`amount <= 0 || amount > payment.amount` is false for `NaN`, so `refundPayment(id, NaN)` passes validation and is forwarded to the gateway. There is also no integer check on a money amount.',
    suggestion: 'Require `Number.isInteger(amount)` before the range check.',
    why: 'Real input-validation hole: NaN compares false against everything.',
  },
  {
    agent: 'Security Reviewer', pr: 483, file: REFUND, startLine: 10, endLine: 21,
    severity: 'WARNING', category: 'security', confidence: 0.7, verdict: 'accept',
    title: 'Check-then-refund is racy: concurrent calls can over-refund',
    rationale: 'The status/amount check and `createRefund` are separate steps with no lock or idempotency key. Two concurrent requests can both pass the check and each issue a refund.',
    suggestion: 'Pass an idempotency key to the gateway and serialise refunds per payment.',
    why: 'Real TOCTOU between the validation and the gateway call.',
  },
  {
    agent: 'Security Reviewer', pr: 483, file: REFUND, startLine: 9, endLine: 9,
    severity: 'WARNING', category: 'security', confidence: 0.62, verdict: 'accept',
    title: 'refundPayment does not check who owns the payment',
    rationale: 'The function takes a bare `paymentId` and never verifies the caller may refund it. If a route exposes it, any caller who knows an id can refund someone else\'s payment (IDOR).',
    suggestion: 'Take the acting user/workspace and verify ownership before refunding.',
    why: 'Real missing authorization in the code being added.',
  },
  {
    agent: 'Security Reviewer', pr: 485, file: LIST, startLine: 11, endLine: 14,
    severity: 'WARNING', category: 'security', confidence: 0.66, verdict: 'accept',
    title: 'Payment list is not scoped to the caller',
    rationale: '`service.list({ status, limit })` receives no user or workspace, so the endpoint returns payments across tenants.',
    suggestion: 'Pass the authenticated workspace id into `service.list` and filter on it.',
    why: 'Real broken access control: no tenant filter in the call.',
  },
  {
    agent: 'Security Reviewer', pr: 483, file: REFUND, startLine: 1, endLine: 75,
    severity: 'CRITICAL', category: 'security', confidence: 0.4, verdict: 'dismiss',
    title: 'Hardcoded secret in refund module',
    rationale: 'The file may contain a gateway credential.',
    suggestion: 'Move secrets to environment variables.',
    why: 'False positive: there is no secret or key anywhere in the file.',
  },
  {
    agent: 'Security Reviewer', pr: 484, file: SERVICE, startLine: 9, endLine: 9,
    severity: 'CRITICAL', category: 'security', confidence: 0.45, verdict: 'dismiss',
    title: 'SQL injection through `repo.insert`',
    rationale: 'User input is spread straight into the repository insert call.',
    suggestion: 'Use parameterised queries.',
    why: 'False positive: no SQL string is built here; the body is zod-validated and inserted as a values object.',
  },
  {
    agent: 'Security Reviewer', pr: 484, file: ROUTES, startLine: 15, endLine: 15,
    severity: 'WARNING', category: 'security', confidence: 0.42, verdict: 'dismiss',
    title: 'Stored XSS through the `memo` field',
    rationale: 'A free-text `memo` is stored and returned unescaped.',
    suggestion: 'Sanitise the memo on write.',
    why: 'False positive: this is a JSON API; escaping is the rendering client\'s job, nothing here renders HTML.',
  },
  {
    agent: 'Security Reviewer', pr: 485, file: LIST, startLine: 4, endLine: 4,
    severity: 'WARNING', category: 'security', confidence: 0.38, verdict: 'dismiss',
    title: 'Query-string injection through `status`',
    rationale: 'The `status` query parameter is user-controlled and used to filter payments.',
    suggestion: 'Validate and escape `status`.',
    why: 'False positive: `status` is already constrained to a three-value `z.enum`.',
  },

  // ============================================================ Performance Reviewer
  {
    agent: 'Performance Reviewer', pr: 485, file: LIST, startLine: 13, endLine: 14,
    severity: 'SUGGESTION', category: 'perf', confidence: 0.6, verdict: 'accept',
    title: 'Every list request pays for a full COUNT',
    rationale: '`rows.total` means each call also counts all matching payments. On a large table that is a scan that grows with the data, on every page fetch.',
    suggestion: 'Return a cursor/`hasMore` flag, or cache the count.',
    why: 'Real cost: an exact total on every page request.',
  },
  {
    agent: 'Performance Reviewer', pr: 485, file: LIST, startLine: 5, endLine: 5,
    severity: 'WARNING', category: 'perf', confidence: 0.64, verdict: 'accept',
    title: 'No offset or cursor: only the first `limit` rows are reachable',
    rationale: 'The query accepts `limit` but no offset or cursor, so a client wanting more than 100 payments cannot page and has to re-query with wider filters.',
    suggestion: 'Add keyset pagination (`after` cursor).',
    why: 'Real scalability gap in the endpoint being changed.',
  },
  {
    agent: 'Performance Reviewer', pr: 483, file: REFUND, startLine: 10, endLine: 10,
    severity: 'WARNING', category: 'perf', confidence: 0.6, verdict: 'accept',
    title: 'Gateway calls have no timeout',
    rationale: '`getPayment` and `createRefund` are awaited with no timeout or abort signal. A slow gateway holds the request (and its connection) open indefinitely.',
    suggestion: 'Pass an `AbortSignal.timeout(...)` to the gateway client.',
    why: 'Real: both awaits sit on the request path with no bound.',
  },
  {
    agent: 'Performance Reviewer', pr: 483, file: REFUND, startLine: 20, endLine: 20,
    severity: 'WARNING', category: 'perf', confidence: 0.58, verdict: 'accept',
    title: 'No idempotency key: client retries duplicate gateway work',
    rationale: 'A timeout followed by a retry sends a second `createRefund`, doubling gateway load and issuing a duplicate refund.',
    suggestion: 'Send an idempotency key derived from payment id and amount.',
    why: 'Real: retries on this path are not safe.',
  },
  {
    agent: 'Performance Reviewer', pr: 483, file: REFUND, startLine: 10, endLine: 20,
    severity: 'SUGGESTION', category: 'perf', confidence: 0.5, verdict: 'dismiss',
    title: 'Run `getPayment` and `createRefund` in parallel',
    rationale: 'Two sequential awaits could be overlapped with `Promise.all` to cut latency.',
    suggestion: 'Use `Promise.all`.',
    why: 'False positive: `createRefund` must wait for the status and amount checks on `getPayment`\'s result.',
  },
  {
    agent: 'Performance Reviewer', pr: 485, file: LIST, startLine: 12, endLine: 14,
    severity: 'WARNING', category: 'perf', confidence: 0.5, verdict: 'dismiss',
    title: 'N+1 query in the payment list endpoint',
    rationale: 'The handler appears to query once per payment.',
    suggestion: 'Batch the lookups.',
    why: 'False positive: there is no loop; `service.list` is called once and returns all rows.',
  },
  {
    agent: 'Performance Reviewer', pr: 483, file: REFUND, startLine: 13, endLine: 13,
    severity: 'SUGGESTION', category: 'perf', confidence: 0.35, verdict: 'dismiss',
    title: 'Template literal in the error path allocates a string',
    rationale: 'Building the message with a template literal allocates on each failure.',
    suggestion: 'Use a constant message.',
    why: 'False positive: negligible, only runs on a failed refund, not a hot path.',
  },
  {
    agent: 'Performance Reviewer', pr: 485, file: LIST, startLine: 5, endLine: 5,
    severity: 'SUGGESTION', category: 'perf', confidence: 0.35, verdict: 'dismiss',
    title: '`z.coerce.number()` is slow on the hot path',
    rationale: 'Coercion runs for every request.',
    suggestion: 'Parse manually.',
    why: 'False positive: one cheap coercion per request; no measurable cost.',
  },

  // ============================================================ Test Quality Reviewer
  {
    agent: 'Test Quality Reviewer', pr: 483, file: REFUND_TEST, startLine: 10, endLine: 13,
    severity: 'WARNING', category: 'tests', confidence: 0.88, verdict: 'accept',
    title: 'The "payment not captured" branch is untested',
    rationale: '`refundPayment` throws when `status !== "captured"`, but the only test mocks a captured payment, so that branch never runs.',
    suggestion: 'Add a test with a `pending` payment that expects a rejection.',
    why: 'Real gap: nothing exercises the first throw.',
  },
  {
    agent: 'Test Quality Reviewer', pr: 483, file: REFUND_TEST, startLine: 10, endLine: 13,
    severity: 'WARNING', category: 'tests', confidence: 0.86, verdict: 'accept',
    title: 'The "amount out of range" branch is untested',
    rationale: 'Neither `amount <= 0` nor `amount > payment.amount` is covered. The only call uses 500 against a 1000 payment.',
    suggestion: 'Add cases for 0, a negative amount and an amount over the payment.',
    why: 'Real gap: the second throw is never reached.',
  },
  {
    agent: 'Test Quality Reviewer', pr: 483, file: REFUND_TEST, startLine: 4, endLine: 12,
    severity: 'WARNING', category: 'tests', confidence: 0.74, verdict: 'accept',
    title: 'Over-mocked: the test only asserts the mock\'s own return value',
    rationale: 'The gateway is fully mocked and the only assertion is `refundId === "re_123"`, which the mock hard-codes. The test never checks that `createRefund` got `("pay_1", 500)`.',
    suggestion: 'Assert `createRefund` was called with the payment id and amount.',
    why: 'Real: the assertion passes whatever the code passes to the gateway.',
  },
  {
    agent: 'Test Quality Reviewer', pr: 483, file: REFUND_TEST, startLine: 9, endLine: 14,
    severity: 'SUGGESTION', category: 'tests', confidence: 0.6, verdict: 'accept',
    title: 'No test for a full refund versus a partial one',
    rationale: 'The doc comment says "in full or in part", but only a partial amount is tested.',
    suggestion: 'Add a case where `amount === payment.amount`.',
    why: 'Real edge case on the boundary of the range check.',
  },
  {
    agent: 'Test Quality Reviewer', pr: 484, file: ROUTES, startLine: 14, endLine: 24,
    severity: 'WARNING', category: 'tests', confidence: 0.7, verdict: 'accept',
    title: 'Route contract change ships with no tests',
    rationale: 'Required `currency`, the 201 status and the `{ payment }` wrapper all change, and the PR touches no test file.',
    suggestion: 'Add route tests for the 201 status, the response shape and rejecting a missing `currency`.',
    why: 'Real: observable behavior changed and no test covers it.',
  },
  {
    agent: 'Test Quality Reviewer', pr: 483, file: REFUND_TEST, startLine: 9, endLine: 14,
    severity: 'WARNING', category: 'tests', confidence: 0.4, verdict: 'dismiss',
    title: 'Test is flaky because it depends on timers',
    rationale: 'The test may depend on timing and fail intermittently.',
    suggestion: 'Use fake timers.',
    why: 'False positive: no timers, sleeps or real I/O; the gateway is mocked.',
  },
  {
    agent: 'Test Quality Reviewer', pr: 483, file: REFUND, startLine: 1, endLine: 75,
    severity: 'WARNING', category: 'tests', confidence: 0.4, verdict: 'dismiss',
    title: '`refund.ts` has no test file',
    rationale: 'The new module ships without any tests.',
    suggestion: 'Add `refund.test.ts`.',
    why: 'False positive: `refund.test.ts` is in the same PR.',
  },
  {
    agent: 'Test Quality Reviewer', pr: 483, file: REFUND_TEST, startLine: 9, endLine: 9,
    severity: 'SUGGESTION', category: 'tests', confidence: 0.35, verdict: 'dismiss',
    title: 'Duplicate test names in the suite',
    rationale: 'Several tests may share a name, making failures ambiguous.',
    suggestion: 'Give each test a unique name.',
    why: 'False positive: the suite has a single test.',
  },

  // ============================================================ API Contract Reviewer
  {
    agent: 'API Contract Reviewer', pr: 484, file: ROUTES, startLine: 14, endLine: 14,
    severity: 'CRITICAL', category: 'api-contract', confidence: 0.92, verdict: 'accept',
    title: 'Request field `currency` becomes required and restricted to an enum',
    rationale: 'It was optional with a `USD` default and any string. Callers that omit it or send another code now get a 400.',
    suggestion: 'Keep the default and widen the enum, or version the endpoint.',
    why: 'Real breaking change to the request schema.',
  },
  {
    agent: 'API Contract Reviewer', pr: 484, file: ROUTES, startLine: 15, endLine: 15,
    severity: 'CRITICAL', category: 'api-contract', confidence: 0.9, verdict: 'accept',
    title: 'Request field `description` renamed to `memo`',
    rationale: 'Clients sending `description` have it silently dropped, and responses stop returning it.',
    suggestion: 'Accept both names during a deprecation window.',
    why: 'Real breaking rename in the request and response.',
  },
  {
    agent: 'API Contract Reviewer', pr: 484, file: ROUTES, startLine: 23, endLine: 23,
    severity: 'WARNING', category: 'api-contract', confidence: 0.86, verdict: 'accept',
    title: 'Success status changes from 200 to 201',
    rationale: 'Clients that check `status === 200` treat the new 201 as a failure.',
    suggestion: 'Document it as a breaking change or keep 200.',
    why: 'Real: the status code is part of the contract.',
  },
  {
    agent: 'API Contract Reviewer', pr: 484, file: ROUTES, startLine: 24, endLine: 24,
    severity: 'CRITICAL', category: 'api-contract', confidence: 0.9, verdict: 'accept',
    title: 'Response body is now wrapped as `{ payment }`',
    rationale: 'The handler used to return the payment object directly. Every client reading `body.id` now gets `undefined`.',
    suggestion: 'Return the payment unwrapped.',
    why: 'Real breaking change to the response shape.',
  },
  {
    agent: 'API Contract Reviewer', pr: 485, file: LIST, startLine: 4, endLine: 4,
    severity: 'CRITICAL', category: 'api-contract', confidence: 0.92, verdict: 'accept',
    title: 'Query param `status` goes from optional to required',
    rationale: 'Requests without `status` now fail validation.',
    suggestion: 'Restore `.optional()`.',
    why: 'Real breaking change to the query contract.',
  },
  {
    agent: 'API Contract Reviewer', pr: 485, file: LIST, startLine: 14, endLine: 14,
    severity: 'CRITICAL', category: 'api-contract', confidence: 0.9, verdict: 'accept',
    title: 'Response field `total` renamed to `count`',
    rationale: 'Clients reading `total` get `undefined`.',
    suggestion: 'Return both fields until clients migrate.',
    why: 'Real breaking rename in the response.',
  },
  {
    agent: 'API Contract Reviewer', pr: 485, file: LIST, startLine: 5, endLine: 5,
    severity: 'WARNING', category: 'api-contract', confidence: 0.45, verdict: 'dismiss',
    title: 'Default of `limit` changed',
    rationale: 'The default page size looks different from before.',
    suggestion: 'Restore the previous default.',
    why: 'False positive: the `limit` line is unchanged (default 20, max 100); only `status` and `total` changed.',
  },
  {
    agent: 'API Contract Reviewer', pr: 483, file: REFUND, startLine: 24, endLine: 24,
    severity: 'WARNING', category: 'api-contract', confidence: 0.4, verdict: 'dismiss',
    title: 'New export `MAX_PARTIAL_REFUNDS` is a breaking change',
    rationale: 'Adding a public export changes the module\'s API surface.',
    suggestion: 'Bump the major version.',
    why: 'False positive: adding an export is backwards-compatible.',
  },
];
