# Spec: Eval Pipeline   |   Spec ID: SPEC-03   |   Status: approved
Modules: server (new `eval` module; schema `server/src/db/schema/eval.ts` + one new generated drizzle migration; reads `reviews` (findings, diff loading), `agents` (config, versions, linked skills), `pulls`; calls `@devdigest/reviewer-core` `reviewPullRequest`; contracts in `server/src/vendor/shared/contracts/eval-ci.ts` + `knowledge.ts`; `server/package.json` script `verify:l06`), client (PR page `FindingCard`, AgentEditor new **Evals** tab, new Eval Dashboard pages, sidebar `NAV`, hooks file for evals, `client/src/vendor/shared` mirror of the eval contracts, `client/messages/en/*` copy), reviewer-core (consumed unchanged)
Supersedes: —

## Problem and why

Review agents are tuned by editing their system prompt, model or linked skills.
Today nothing tells the author whether an edit made the agent better or worse:
the only signal is re-running reviews on live PRs and eyeballing the output.
Live PR runs are not comparable over time either — the diff, intent, repo-intel
context and project documents all change between runs.

The product already collects the ground truth: users **accept** findings that
are real and **dismiss** findings that are noise (`findings.accepted_at` /
`findings.dismissed_at`, `POST /findings/:id/accept|dismiss`). This feature
turns those decisions into a regression suite:

- one click on a decided finding freezes its input (the file's diff section +
  PR meta) and its expectation into an **eval case** owned by the agent that
  produced it — accepted → `must_find`, dismissed → `must_not_flag`;
- the agent can be run on all its cases (a **batch**); the batch records the
  agent version and a snapshot of its configuration;
- scoring is deterministic code (no LLM): **recall**, **precision**,
  **citation_accuracy**, pass/total;
- run history, a metric trend, a regression banner and a side-by-side
  **Compare** of two batches (including the system-prompt diff) show whether a
  change helped.

Existing assets this feature builds on (verified in the working tree):

- Tables `eval_cases` and `eval_runs` already exist (migration `0000_init`).
  `eval_runs` is one row per case execution and has **no** way to group rows
  into one run of the whole set, nor to record the agent version or prompt — so
  a schema extension is required (see "Data and contracts").
- Contracts `EvalCase`, `EvalRun`, `EvalPerTrace`, `EvalOwnerKind`
  (`knowledge.ts`) and `EvalCaseInput`, `EvalRunRecord`, `EvalRunResult`,
  `EvalTrendPoint`, `EvalDashboard` (`eval-ci.ts`).
- Agent versioning: `agents.version` + immutable `agent_versions.config_json`
  snapshots on every config change (`GET /agents/:id/versions[/:version]`).
  Linking/unlinking/toggling a **skill does not bump the version** — hence the
  batch snapshots linked skills itself.
- `reviewPullRequest` (reviewer-core) returns grounded findings
  (`review.findings`), grounding-dropped findings (`dropped`) and `costUsd`; the
  grounding gate (`groundFindings`) is pure code.
- `parseUnifiedDiff` (server git adapter) can rebuild a diff from stored text;
  `loadDiff` yields a PR's diff (git, falling back to `pr_files` patches).

## Goals / Non-goals

### Goals

- G1. Create an eval case from an accepted or dismissed finding in one click,
  with the expectation type derived from the decision.
- G2. List an agent's eval cases with their latest result; view a case
  read-only; delete a case.
- G3. Run an agent on all its cases (background batch) or on a single case.
- G4. Score every case and batch in code with zero LLM calls: recall,
  precision, citation_accuracy, pass/total, cost, duration.
- G5. Agent-level run history, metric tiles with delta and sparkline, metric
  trend chart, deterministic regression banner.
- G6. Compare two batches of the same agent: metric deltas (incl. cost) and a
  system-prompt diff.
- G7. Workspace Eval Dashboard in the sidebar (per-agent rows + recent runs of
  all agents) with "Run all agents".
- G8. A green-able `pnpm verify:l06` gate covering the feature's unit and
  integration tests.

### Non-goals

- NG1. "Promote vN" (rolling an agent back/forward to a compared version).
- NG2. Date-range filter on the agent eval page.
- NG3. Skills as eval-case owners. `owner_kind` keeps both enum values in the
  contract, but this feature creates, lists and runs `agent` cases only.
- NG4. The manual case editor (Expected-output JSON editor, Files / PR-meta
  input tabs, "Finding skeleton", "Run on save", editing a case). Cases are
  viewed read-only.
- NG5. A seed of eval cases. Every case comes from a real finding; the ≥ 8-case
  course criterion is met manually by the user.
- NG6. Bumping the agent version when linked skills change (the batch snapshot
  covers comparability instead).
- NG7. Re-syncing a case when its source finding's decision changes later
  (cases are frozen at creation).
- NG8. Feeding intent, repo-intel (callers, repo map, rank note) or project
  context documents into eval runs (they make runs non-comparable).
- NG9. LLM-judged scoring of any kind (semantic matching of titles/rationale).
- NG10. Cancelling a running batch.

## User stories

- US-1. As an agent author, when I accepted a finding, I click "Turn into eval
  case" and get a `must_find` case ("must find X at file:line") for the agent
  that produced it.
- US-2. As an agent author, when I dismissed a finding, I click "Turn into eval
  case" and get a `must_not_flag` case ("must NOT flag Y at file:line").
- US-3. As an agent author, I see all eval cases in my agent's set with their
  latest pass/fail, and can open one read-only or delete it.
- US-4. As an agent author, I run my agent on all cases of its set (or on one
  case) and watch progress until it finishes.
- US-5. As an agent author, I see a run's recall / precision / citation
  accuracy, pass count and cost, and how they moved since the previous run.
- US-6. As an agent author, I open the run history and compare two runs side by
  side (old prompt vs new prompt) to see which metrics moved and why.
- US-7. As a workspace user, I open the Eval Dashboard to see every agent's
  latest eval health and recent runs, and can run all agents' evals at once.
- US-8. As a course participant / maintainer, I run `pnpm verify:l06` and get a
  trustworthy green/red for the feature's tests, including proof that scoring
  makes no LLM call.

## Data and contracts

This section defines observable data shapes; column types, file layout and
query design are left to the planner.

### Persistence changes (one new generated drizzle migration)

The existing `eval_cases` / `eval_runs` columns are kept. Required additions:

- **`eval_batches`** (new table) — one row per run of an agent's set (or of a
  single case): `id`, `workspace_id`, `agent_id`, `scope` (`set` | `case`),
  `agent_version` (integer, `agents.version` at start), `config_snapshot`
  (provider, model, system_prompt, strategy, and the linked **enabled** skills
  in order with name + body as they reached the prompt), `status`
  (`running` | `done` | `failed`), `error` (nullable), `started_at`,
  `finished_at` (nullable), `cases_total`, `cases_done`, aggregate `recall`,
  `precision`, `citation_accuracy` (nullable), `traces_passed`,
  `traces_total`, `cost_usd` (nullable), `duration_ms` (nullable).
- **`eval_runs.batch_id`** — required reference to `eval_batches`, cascade on
  batch delete; **`eval_runs.error`** — nullable text for a case that errored.
- **`eval_cases.source_finding_id`** — nullable reference to `findings`; when the
  finding (or its review/PR) is deleted the case survives with the value
  cleared. Unique per (`owner_kind`, `owner_id`, `source_finding_id`).
- **`eval_cases.created_at`** — creation timestamp.
- Deleting an agent removes its eval cases and eval batches (and through them
  all `eval_runs`). The mechanism (FK on `owner_id` for agent-owned rows or an
  explicit delete in the agent delete path) is the planner's choice.

Migrations are generated by `drizzle-kit generate` from the schema change —
`server/src/db/migrations/**` is never hand-edited.

### `expected_output` (stored on `eval_cases`)

```jsonc
{
  "type": "must_find" | "must_not_flag",
  "file": "src/auth/session.ts",
  "start_line": 42,
  "end_line": 47,
  "kind": "finding",            // FindingKind of the source finding
  "severity": "WARNING",        // informational, not used for matching
  "category": "security",       // informational, not used for matching
  "title": "Session token logged in plaintext",
  "source_finding_id": "uuid"
}
```

### Frozen input (stored on `eval_cases`)

- `input_diff` — the unified-diff section for the finding's file only
  (`diff --git` header, `---`/`+++` lines and all hunks of that file), taken
  from the PR diff at case creation (`loadDiff`: git, else `pr_files`).
- `input_files` — `null` (NG4).
- `input_meta` —
  `{ pr: { repo: "owner/name", number, title, body, base, head_sha }, finding: { id, review_id, run_id, severity, category, kind, title, rationale, suggestion, file, start_line, end_line, confidence, decision: "accepted"|"dismissed", decided_at } }`.

### Contracts (`@devdigest/shared`, mirrored by hand into `client/src/vendor/shared`)

Existing schemas are extended, not replaced:

- `EvalExpectation` — the `expected_output` shape above.
- `EvalCaseDto` — `EvalCase` + `source_finding_id: string | null`,
  `created_at`, `expectation: EvalExpectation`,
  `last_result: { pass: boolean | null, error: string | null, ran_at, actual_count: number, matched_count: number } | null`.
- `EvalBatch` — the `eval_batches` row in API form (snake_case), plus
  `agent_name`; `config_snapshot` included only on single-batch and compare
  responses.
- `EvalRunRecord` gains `batch_id` and `error` (nullable).
- `EvalTrendPoint` gains `batch_id` and `agent_version`; its `recall`,
  `precision`, `citation_accuracy` become `number | null`.
- `EvalDashboard.current` becomes nullable (null = no `done` set batch); the
  three metrics inside `current` and `delta` become `number | null`. Field
  names are unchanged; the client mirror changes identically.
- `EvalDashboard` keeps all its fields; `recent_runs` stays per-case;
  gains `recent_batches: EvalBatch[]` and `running_batch_id: string | null`.
- `EvalWorkspaceDashboard` —
  `{ agents: AgentEvalSummary[], recent_batches: EvalBatch[] }` where
  `AgentEvalSummary = { agent_id, agent_name, model, enabled, cases_total, last_batch: EvalBatch | null, sparkline: number[], running_batch_id: string | null }`.
- `EvalCompare` — `{ base: EvalBatch, head: EvalBatch, delta: { recall, precision, citation_accuracy, cost_usd } (each number | null), prompt_diff: { op: "same"|"add"|"del", text: string }[], model_changed: boolean }`.
- Finding DTO (`ReviewDtoFinding`) gains `eval_case_id: string | null`.
- `actual_output` on `eval_runs`:
  `{ findings: Finding[] /* grounded */, dropped: { finding: Finding, reason: string }[], matched_finding_ids: string[] }`.

### HTTP API (all workspace-scoped; ids are uuids)

| Method & path | Success | Errors |
|---|---|---|
| `POST /findings/:id/eval-case` | `201 EvalCaseDto` | 404 not found / other workspace; 409 `already_eval_case` (body carries existing `case_id`); 422 `finding_undecided`; 422 `agent_missing`; 422 `file_not_in_diff`; 422 `diff_too_large` |
| `GET /agents/:id/eval-cases` | `200 EvalCaseDto[]` newest first | 404 |
| `GET /eval-cases/:id` | `200 EvalCaseDto` (+ `input_diff`, `input_meta`) | 404 |
| `DELETE /eval-cases/:id` | `204` | 404; 409 `batch_running` |
| `POST /agents/:id/eval-runs` | `202 { batch_id }` | 404; 409 `batch_running` (body carries running `batch_id`); 422 `no_eval_cases` |
| `POST /eval-cases/:id/run` | `202 { batch_id }` (scope `case`) | 404; 409 `batch_running` |
| `GET /agents/:id/eval-runs` | `200 EvalBatch[]` scope `set`, newest first, max 50 | 404 |
| `GET /eval-runs/:batchId` | `200 EvalBatch` + `runs: EvalRunRecord[]` + `config_snapshot` | 404 |
| `GET /eval-runs/compare?base=&head=` | `200 EvalCompare` | 404; 422 `different_agents` / `not_comparable` |
| `GET /agents/:id/eval-dashboard` | `200 EvalDashboard` | 404 |
| `GET /eval-dashboard` | `200 EvalWorkspaceDashboard` | — |
| `POST /eval-runs/all` | `202 { started: {agent_id,batch_id}[], skipped: {agent_id, reason: "running"\|"no_cases"\|"disabled"}[] }` | — |

### Batch run flow

```mermaid
sequenceDiagram
  participant UI as Client (Evals tab / dashboard)
  participant API as server eval module
  participant DB as Postgres
  participant RC as reviewer-core
  participant LLM as LLM provider
  UI->>API: POST /agents/:id/eval-runs
  API->>DB: running batch for agent? (409) / count cases (422)
  API->>DB: insert eval_batches(status=running, agent_version, config_snapshot)
  API-->>UI: 202 {batch_id}
  loop each case (sequential)
    API->>RC: reviewPullRequest(frozen diff, frozen PR meta, snapshot prompt/model/strategy/skills)
    RC->>LLM: review call(s)
    RC-->>API: grounded findings + dropped + cost
    API->>API: score case in code (no LLM)
    API->>DB: insert eval_runs row; cases_done += 1
  end
  API->>API: aggregate batch metrics in code
  API->>DB: update batch aggregates, then status=done, finished_at
  loop every 2 s until status != running
    UI->>API: GET /eval-runs/:batchId
  end
```

### Scoring rules (pure code)

- **Match**: an actual finding matches an expectation when its `file` equals the
  expectation's `file` (after normalising a leading `./` or `/` and `\` → `/`)
  AND the closed ranges `[start_line, end_line]` overlap (inclusive, 0-line
  tolerance; a reversed range is normalised to min..max). If the expectation's
  `kind` or the actual finding's `kind` is a full-file kind (`secret_leak`,
  `lethal_trifecta`, `phantom`, `hook`), file equality alone matches.
  Severity, category and title are ignored.
- **Pass**: `must_find` passes iff ≥ 1 grounded actual finding matches;
  `must_not_flag` passes iff 0 grounded actual findings match. A case whose
  agent call errored has `pass = null`.
- **Per case**: `must_find` → recall = 1 or 0, precision = null;
  `must_not_flag` → recall = null, precision = 1 − matched ÷ produced
  (1.0 when produced = 0); citation_accuracy = grounded ÷ (grounded + dropped),
  null when both are 0.
- **Batch** (over non-errored cases): recall = passed `must_find` ÷ run
  `must_find` (null when 0); precision = 1 − Σ matched-on-`must_not_flag` ÷
  Σ grounded-produced-on-`must_not_flag` (1.0 when the denominator is 0 but
  ≥ 1 `must_not_flag` case ran; null when no `must_not_flag` case ran);
  citation_accuracy = Σ grounded ÷ Σ (grounded + dropped) over all cases (null
  when 0); traces_passed = cases with `pass = true`; traces_total = all cases
  in the batch (errored included); cost_usd = Σ case costs, null if any case
  cost is null; duration_ms = finished_at − started_at.

## Acceptance criteria (EARS)

### Case creation (FindingCard)

- **AC-1** The FindingCard action row shall show, in this order: Accept,
  Dismiss, "Turn into eval case".
  Verify: RTL test renders FindingCard and asserts button order.
- **AC-2** WHILE a finding is neither accepted nor dismissed, the FindingCard
  shall render "Turn into eval case" disabled with the tooltip/`aria-describedby`
  text "Accept or dismiss the finding first".
  Verify: RTL test with `accepted_at = dismissed_at = null`.
- **AC-3** WHEN the user clicks "Turn into eval case" on an accepted finding,
  the server shall create, without any further dialog, an eval case owned by
  the agent of the finding's review with `expected_output.type = "must_find"`
  and return 201 with the `EvalCaseDto`.
  Verify: integration — accept finding, `POST /findings/:id/eval-case`, assert
  201 + `expectation.type`, `owner_id = review.agent_id`.
- **AC-4** WHEN the user clicks "Turn into eval case" on a dismissed finding,
  the server shall create an eval case with
  `expected_output.type = "must_not_flag"` and return 201.
  Verify: integration — same as AC-3 with dismiss.
- **AC-5** WHEN an eval case is created, the server shall store as frozen
  input exactly the unified-diff section of the finding's file from the PR diff
  (`input_diff`), the PR meta and the source-finding snapshot (`input_meta`),
  and `input_files = null`, as defined in "Frozen input".
  Verify: unit `frozen-input.test.ts` — multi-file diff in, single-file section
  out with all its hunks; integration asserts stored `input_meta` keys.
- **AC-6** WHEN an eval case is created, the server shall name it
  "Must find: <finding title>" or "Must not flag: <finding title>", truncated
  to 120 characters.
  Verify: unit test on the name builder with a 200-char title.
- **AC-7** IF the finding is neither accepted nor dismissed, THEN
  `POST /findings/:id/eval-case` shall return 422 `finding_undecided` and
  create nothing.
  Verify: integration on an undecided finding; assert 0 rows in `eval_cases`.
- **AC-8** IF an eval case already exists for the same agent and source
  finding, THEN `POST /findings/:id/eval-case` shall return 409
  `already_eval_case` with the existing `case_id` and create nothing.
  Verify: integration — POST twice; second is 409, row count stays 1.
- **AC-9** IF the finding's review has no agent or that agent no longer exists,
  THEN the endpoint shall return 422 `agent_missing`.
  Verify: integration — delete the agent, then POST.
- **AC-10** IF the finding's file is not present in the PR diff (or has no
  hunks), THEN the endpoint shall return 422 `file_not_in_diff` and create
  nothing.
  Verify: integration with a finding whose file is absent from `pr_files`.
- **AC-11** IF the file's diff section exceeds 200 000 characters, THEN the
  endpoint shall return 422 `diff_too_large` and create nothing.
  Verify: unit on the size guard; integration with an oversized patch.
- **AC-12** IF the finding belongs to another workspace or does not exist, THEN
  the endpoint shall return 404.
  Verify: integration with a random uuid.
- **AC-13** The finding DTO returned by every finding read and write path
  (review list, latest review, accept, dismiss, eval-case creation) shall carry
  `eval_case_id` (the case id or `null`).
  Verify: integration — after creating a case, `POST /findings/:id/accept`
  response still carries the non-null `eval_case_id`.
- **AC-14** WHILE a finding has a non-null `eval_case_id`, the FindingCard
  shall render the button as disabled "In eval set" with a check icon.
  Verify: RTL test with `eval_case_id` set.
- **AC-15** WHEN case creation succeeds, the FindingCard shall switch to the
  "In eval set" state without a page reload and show the toast
  "Eval case created for <agent name>".
  Verify: RTL test with mocked hook; manual on PR page.
- **AC-16** IF case creation fails, THEN the FindingCard shall show a toast
  with the server error message mapped to copy ("Already an eval case", "Accept
  or dismiss the finding first", "The agent that produced this finding was
  deleted", "File is not in the PR diff", "Diff section is too large") and keep
  the button enabled (except for 409, which switches to "In eval set").
  Verify: RTL tests per error code.
- **AC-17** WHILE the creation request is in flight, the FindingCard shall
  disable "Turn into eval case" so a double click sends one request.
  Verify: RTL test — two clicks, one mutate call.

### Case list, view, delete (AgentEditor → Evals tab)

- **AC-18** The AgentEditor shall show the tabs Config · Skills · Context ·
  Evals, and `?tab=evals` shall open the Evals tab.
  Verify: RTL test on AgentEditor + `VALID_TABS`.
- **AC-19** WHEN the Evals tab opens, the client shall list the agent's eval
  cases (newest first) with, per row: status icon (pass / fail / error /
  never-run), name, result text, `severity · category` chip, and run, view and
  delete icon buttons.
  Verify: RTL test with 4 cases covering each status.
- **AC-20** The case row result text shall read "expected 1 finding at
  <file>:<start>, got <matched> matching" for `must_find` and "expected no
  finding at <file>:<start>, got <matched> matching" for `must_not_flag`, and
  "never run" when `last_result` is null.
  Verify: unit on the helper that formats the text.
- **AC-21** The Evals tab header shall show "Eval cases <passed>/<total>
  passing", where passed counts cases whose `last_result.pass = true`.
  Verify: RTL test.
- **AC-22** WHEN the user clicks the view icon, the client shall open a
  read-only panel showing the case name, expectation (type, file, lines), the
  source finding's title/rationale, PR reference (`owner/name#number`), the
  frozen diff section, and the last result (pass, matched/actual counts,
  ran at).
  Verify: RTL test; manual.
- **AC-23** WHEN the user confirms delete on a case, the server shall delete the
  case and its `eval_runs` rows and the client shall remove the row; existing
  batch aggregates shall stay unchanged.
  Verify: integration — delete case, assert batch row metrics unchanged and
  `eval_runs` for that case gone.
- **AC-24** IF a batch for the case's agent is running, THEN `DELETE
  /eval-cases/:id` shall return 409 `batch_running`.
  Verify: integration with a batch held in `running`.
- **AC-25** WHERE the agent has zero eval cases, the Evals tab shall show the
  empty state "No eval cases yet. Open a pull request, accept or dismiss a
  finding from this agent, then click "Turn into eval case"." and disable "Run
  all evals".
  Verify: RTL test.
- **AC-26** WHEN the user clicks "+ New eval case", the client shall show the
  same instructions as AC-25 (no editor; NG4).
  Verify: RTL test.
- **AC-27** The Evals tab shall show the "Eval metrics" tiles recall,
  precision, citation accuracy (percent, 0 decimals) and traces passed
  (`x/y`) from the agent's latest `done` `set` batch, each with its delta in
  points versus the previous `done` `set` batch, and a "View full dashboard →"
  link to `/evals/<agentId>`.
  Verify: RTL test with two batches.

### Running

- **AC-28** WHEN `POST /agents/:id/eval-runs` is called and the agent has ≥ 1
  eval case and no running batch, the server shall insert a batch with
  `status = running`, `scope = set`, `agent_version`, `config_snapshot`,
  `cases_total`, and return 202 `{ batch_id }` before any case executes.
  Verify: integration with a slow mock LLM; response arrives while status is
  `running`.
- **AC-29** IF the agent has zero eval cases, THEN the endpoint shall return
  422 `no_eval_cases` and create no batch.
  Verify: integration.
- **AC-30** IF a batch (either scope) for the agent has `status = running`,
  THEN `POST /agents/:id/eval-runs` and `POST /eval-cases/:id/run` shall return
  409 `batch_running` with the running `batch_id`.
  Verify: integration — two POSTs back to back.
- **AC-31** WHILE a batch runs, the server shall execute its cases one at a time
  using only the batch's `config_snapshot` (system prompt, provider, model,
  strategy, skill bodies), the case's frozen diff, and the frozen PR title,
  number and description; it shall pass no intent, callers, repo map, rank
  note or project-context documents.
  Verify: unit `executor.test.ts` — capture the `reviewPullRequest` input and
  assert the absent keys and the snapshot values.
- **AC-32** WHEN the agent is edited while its batch runs, the server shall
  continue the batch with the snapshot captured at start.
  Verify: unit — mutate agent between cases; captured inputs unchanged.
- **AC-33** WHEN a case finishes, the server shall persist its `eval_runs` row
  (actual_output, pass, per-case metrics, duration, cost) and increment the
  batch's `cases_done` before starting the next case.
  Verify: integration polling `cases_done`.
- **AC-34** IF one case's agent call throws, THEN the server shall store that
  case with `pass = null` and its `error` message and continue with the next
  case.
  Verify: unit — mock LLM throwing on case 2 of 3; batch `done`, 2 scored.
- **AC-35** IF the agent's provider cannot be resolved (e.g. missing API key)
  before the first case, THEN the server shall mark the batch `failed` with the
  error message and execute no case.
  Verify: integration with an unconfigured provider.
- **AC-36** WHEN all cases are persisted, the server shall write the batch
  aggregates and only then set `status = done` and `finished_at`.
  Verify: integration — the first poll that sees `done` already has non-null
  aggregates and `runs.length = cases_total`.
- **AC-37** WHEN `POST /eval-cases/:id/run` is called, the server shall create
  a batch with `scope = case` containing only that case and return 202
  `{ batch_id }`.
  Verify: integration.
- **AC-38** The run history, trend, sparklines, banner, Compare and
  dashboard aggregates shall consider only `scope = set` batches; the case's
  `last_result` shall use the latest `eval_runs` row from either scope.
  Verify: integration — a `case` batch does not appear in
  `GET /agents/:id/eval-runs`.
- **AC-39** WHILE a batch for the agent is running, the client shall poll
  `GET /eval-runs/:batchId` every 2 s, show "Running <cases_done>/<cases_total>"
  on the "Run all evals" / "Run eval" button and disable it, and stop polling
  once the status is `done` or `failed`.
  Verify: RTL test with fake timers; manual.
- **AC-40** WHEN the Evals tab or the agent eval page loads while a batch is
  running (`running_batch_id` non-null), the client shall resume polling that
  batch.
  Verify: RTL test.
- **AC-41** WHEN a batch ends, the client shall refresh the case list, tiles
  and history, and show the toast "Eval run finished — <passed>/<total>
  passed" or "Eval run failed: <error>".
  Verify: RTL test.
- **AC-42** IF a batch has been `running` for more than 30 minutes AND it is
  not in this server process's in-memory eval queue (running or waiting), THEN the
  server shall treat it as `failed` with error "stale: run did not finish"
  on the next read or run request, so it no longer blocks new batches.
  Verify: integration — insert a batch with `started_at` 31 min ago, POST a new
  run, expect 202.

### Scoring

- **AC-43** The scorer shall count an actual finding as matching an
  expectation per the "Match" rule (normalised file equality and inclusive
  line-range overlap; file-only for full-file kinds).
  Verify: unit `scoring.test.ts` — touching ranges (10–12 vs 12–15) match;
  adjacent (10–12 vs 13–15) do not; other file does not; `./a.ts` vs `a.ts`
  match; `hook` kind matches on file only.
- **AC-44** The scorer shall compute per-case pass and per-case metrics
  exactly as in "Scoring rules".
  Verify: unit — table of must_find/must_not_flag × 0/1/2 matches.
- **AC-45** The scorer shall compute batch recall, precision,
  citation_accuracy, traces_passed, traces_total and cost_usd exactly as in
  "Scoring rules", including: no `must_find` cases → recall `null`; no
  `must_not_flag` cases → precision `null`; `must_not_flag` cases with zero
  produced findings → precision 1.0; zero findings overall → citation `null`;
  any null case cost → batch cost `null`.
  Verify: unit — one test per edge.
- **AC-46** The scorer shall make zero LLM calls.
  Verify: unit — scoring a batch with an injected LLM provider whose every
  method throws completes successfully; the executor test asserts the LLM mock
  is called once per case per chunk and never during scoring.
- **AC-47** The citation_accuracy of a case shall be computed from the
  reviewer-core grounding result: grounded findings ÷ (grounded + dropped).
  Verify: unit with a mock LLM returning 3 findings, 1 outside any hunk →
  0.667.

### History, trend, banner (agent eval page `/evals/<agentId>`)

- **AC-48** The agent eval page shall show: breadcrumb "Eval Dashboard ›
  <agent name>", a back link to `/evals`, an agent selector that navigates to
  `/evals/<otherAgentId>`, and a "Run eval" button (AC-28 / AC-39 behaviour).
  Verify: RTL test; e2e manual.
- **AC-49** The agent eval page shall show three metric tiles (recall,
  precision, citation accuracy) with the latest `done` `set` batch value, the
  signed delta in points versus the previous one (e.g. "−2 pts"), and a
  sparkline of that metric over the last 10 `done` `set` batches.
  Verify: RTL test with 3 batches.
- **AC-50** The agent eval page shall show a line chart of recall, precision
  and citation accuracy over the last 50 `done` `set` batches in chronological
  order, x-axis labelled by `v<agent_version>` and date.
  Verify: RTL test asserts 3 series and point count; manual visual.
- **AC-51** The agent eval page shall show a recent-runs table (newest first,
  max 50) with columns: checkbox, ran at, version (`v<N>`), recall, precision,
  citation, pass (`x/y`), cost (`$0.0000` or "—"), and status for non-`done`
  rows ("running", "failed").
  Verify: RTL test.
- **AC-52** WHEN the latest `done` `set` batch has a metric (recall,
  precision or citation accuracy) at least 2 points below the previous `done`
  `set` batch, the server shall set `EvalDashboard.alert` and the page shall
  show a banner "<Metric> dipped <N> pts on v<version> — <reason>", choosing
  the metric with the largest drop, where reason is "an expected finding was
  missed" (recall), "a new false positive slipped in" (precision), "more
  findings failed citation grounding" (citation).
  Verify: unit on the alert rule (drops 1.9 → none, 2.0 → banner, ties pick
  recall > precision > citation); RTL test for the banner.
- **AC-53** IF either compared metric is `null`, THEN the alert rule shall skip
  that metric.
  Verify: unit.
- **AC-54** WHERE the agent has fewer than 2 `done` `set` batches, the page
  shall show deltas as "—", no banner, and a chart/sparkline with the points
  available (empty state "No eval runs yet — click Run eval" when 0).
  Verify: RTL tests for 0 and 1 batch.

### Compare

- **AC-55** WHILE exactly 2 rows with status `done` are checked in the
  recent-runs table, the "Compare" button shall be enabled; otherwise it shall
  be disabled, and checking a third row shall be prevented.
  Verify: RTL test.
- **AC-56** WHEN the user clicks "Compare", the client shall call `GET
  /eval-runs/compare?base=<older>&head=<newer>` (ordered by `started_at`) and
  open a modal titled "Compare runs · v<base version> → v<head version>".
  Verify: RTL test.
- **AC-57** The Compare modal shall show four tiles — recall, precision,
  citation accuracy, cost — each as "old → new" with the signed delta (points
  for metrics, dollars for cost; "—" when either side is null).
  Verify: unit on delta computation; RTL test.
- **AC-58** The Compare modal shall show a line-based diff of the two
  snapshotted system prompts, removed lines marked and highlighted red, added
  lines marked and highlighted green, unchanged lines plain; WHERE the prompts
  are identical it shall show "System prompt unchanged".
  Verify: unit on `prompt_diff` (server); RTL test on rendering.
- **AC-59** WHERE the two batches differ in model or in linked skills, the
  Compare modal shall show a line "Model: <old> → <new>" and/or "Skills:
  <old list> → <new list>".
  Verify: RTL test.
- **AC-60** IF the two batch ids belong to different agents, or either is not a
  `done` `set` batch, THEN the compare endpoint shall return 422.
  Verify: integration.
- **AC-61** The Compare modal shall close on "Close", on Escape, and on
  backdrop click, returning focus to the "Compare" button.
  Verify: RTL test.

### Eval Dashboard (`/evals`)

- **AC-62** The sidebar "SKILLS LAB" group shall contain "Eval Dashboard"
  (after Agents) linking to `/evals`, and the page breadcrumb shall read
  "Skills Lab › Eval Dashboard".
  Verify: RTL test on Sidebar/NAV; manual.
- **AC-63** The Eval Dashboard shall show one row per agent in the workspace
  with: name, model chip, "Last run v<N> · <date> · <passed>/<total> pass" (or
  "Never run", or "No eval cases"), a pass-rate sparkline over the last 10
  `done` `set` batches, and RECALL / PREC / CITE percentages of the latest
  `done` `set` batch ("—" when absent); clicking a row opens `/evals/<agentId>`.
  Verify: RTL test; integration on `GET /eval-dashboard`.
- **AC-64** The Eval Dashboard shall show "Recent eval runs · all agents": the
  latest 20 `set` batches across agents, newest first, with agent, ran at,
  version, recall/precision/citation as bars with percentage labels, and pass
  `x/y`.
  Verify: RTL test; integration.
- **AC-65** WHEN the user clicks "Run all agents", the server shall start a
  `set` batch for every enabled agent that has ≥ 1 case and no running batch,
  and return 202 with `started` and `skipped` (reason `running`, `no_cases`,
  `disabled`); the client shall show "Started <n> runs, skipped <m>" and poll
  each started batch every 2 s until terminal.
  Verify: integration with 3 agents (one running, one without cases, one
  ready); RTL test.
- **AC-66** The server shall execute every batch (single agent, single case,
  or "Run all agents") through one process-wide FIFO queue, at most one batch
  at a time; "Run all agents" enqueues agents in name order.
  Verify: unit on the executor queue.

### Gate (`verify:l06`)

- **AC-67** The `server` package shall expose `pnpm verify:l06`, which runs
  `src/modules/eval/scoring.test.ts`, `src/modules/eval/frozen-input.test.ts`,
  `src/modules/eval/executor.test.ts`, `test/eval-contract-parity.test.ts` and
  `test/eval.it.test.ts`, and exits 0 only if all pass.
  Verify: run `cd server && pnpm verify:l06`; break one assertion → non-zero.
- **AC-68** IF `test/eval.it.test.ts` executes zero tests (e.g. Docker probe
  failed and the suite skipped), THEN `pnpm verify:l06` shall exit non-zero
  with a message naming the skipped suite.
  Verify: run with Docker stopped → non-zero exit.
- **AC-69** The contract-parity test shall assert that every eval schema in
  `server/src/vendor/shared` and `client/src/vendor/shared` accepts and rejects
  the same fixture set.
  Verify: change one field in the client copy → test fails.
- **AC-70** The integration test shall cover, against a real Postgres with a
  mock LLM: case creation from accepted and dismissed findings (201, 409, 422),
  a full batch to `done` with persisted per-case rows and aggregates, 409 on a
  concurrent run, 422 on zero cases, and cascade on agent delete.
  Verify: `pnpm exec vitest run test/eval.it.test.ts` shows ≥ 1 executed test
  per listed behaviour.

### Lifecycle and security

- **AC-71** WHEN an agent is deleted, the server shall delete its eval cases,
  eval batches and their eval runs.
  Verify: integration.
- **AC-72** WHEN the source finding (or its review/PR) is deleted, the eval
  case shall remain runnable with `source_finding_id = null`.
  Verify: integration — delete the review, run the case.
- **AC-73** IF any eval endpoint receives an id from another workspace, THEN it
  shall return 404 and reveal nothing about the resource.
  Verify: integration with two workspaces.
- **AC-74** IF a path id is not a uuid, THEN the endpoint shall reject the
  request with the existing validation error status (422) before touching the
  database.
  Verify: integration `GET /eval-runs/not-a-uuid`.

## Edge cases

| # | Case | Handling |
|---|---|---|
| E-1 | Finding undecided | Button disabled (AC-2); API 422 (AC-7) |
| E-2 | Same finding clicked twice / two tabs | 409 + existing id (AC-8, AC-15/16) |
| E-3 | Finding's agent deleted | 422 `agent_missing` (AC-9) |
| E-4 | File absent from diff / binary / deleted-file without hunks | 422 `file_not_in_diff` (AC-10) |
| E-5 | Huge file section | 422 `diff_too_large` (AC-11) |
| E-6 | Findings always have file + lines (`not null` columns) | No "no line info" path; full-file kinds match by file (AC-43) |
| E-7 | Decision flipped after case creation | Case keeps its frozen expectation (NG7); user deletes and recreates |
| E-8 | Agent edited mid-batch | Snapshot from start is used (AC-32) |
| E-9 | Linked skills changed without a version bump | Snapshot records skills; Compare shows them (AC-59) |
| E-10 | Concurrent run requests | 409 (AC-30) |
| E-11 | Zero cases | 422 (AC-29); disabled button (AC-25) |
| E-12 | One case's LLM call fails | Case error, batch continues (AC-34) |
| E-13 | Provider key missing | Batch `failed`, no case runs (AC-35) |
| E-14 | Server restarts mid-batch | Stale rule (AC-42) |
| E-15 | Polling client sees `done` before rows persisted | Ordering guarantee (AC-36) |
| E-16 | Precision with no findings on must_not_flag cases | 1.0; no must_not_flag cases → null (AC-45) |
| E-17 | Reversed or single-line ranges | Normalised, inclusive overlap (AC-43) |
| E-18 | Path spelling differences (`./`, `\`) | Normalised (AC-43) |
| E-19 | Fewer than 2 batches | "—" deltas, no banner (AC-54) |
| E-20 | Compare across agents / non-done batches | 422 (AC-60) |
| E-21 | Case deleted while batch running | 409 (AC-24) |
| E-22 | Case deleted after runs | Batch aggregates unchanged (AC-23) |
| E-23 | Source finding / PR deleted | Case survives (AC-72) |
| E-24 | Cost unknown for a case | Batch cost null, shown "—" (AC-45, AC-51) |
| E-25 | Agent disabled | Single-agent "Run eval" allowed; "Run all agents" skips it (AC-65). |
| E-26 | Derived `eval_case_id` blanked by accept/dismiss response | Every write path fills it (AC-13; see server INSIGHTS 2026-09-21) |
| E-27 | Long titles / unicode / long file paths | Name truncated to 120 chars (AC-6); UI truncates with ellipsis and full text in `title` attribute |
| E-28 | `.it` suite silently skipped | verify fails (AC-68) |

## Non-functional

- **Performance**: scoring a batch of 100 cases × 20 findings each completes in
  < 100 ms (unit benchmark assertion). `GET /eval-dashboard` and `GET
  /agents/:id/eval-dashboard` respond in < 500 ms p95 with 20 agents × 200
  batches × 10 cases on a local Postgres. `POST /agents/:id/eval-runs` returns
  202 in < 300 ms independent of case count (AC-28).
- **Cost**: eval LLM calls are exactly the agent-under-test review calls (one
  per case per chunk); scoring and comparison make none (AC-46). Batch cost is
  shown on every run row and in Compare.
- **Reliability**: one failing case never fails the batch (AC-34); terminal
  status only after persistence (AC-36); stale batches do not block forever
  (AC-42).
- **Determinism / comparability**: identical frozen inputs across runs;
  intent, repo-intel and project context excluded (AC-31). LLM output itself
  stays non-deterministic — the metric difference between two runs of the same
  version is noise the user reads, not something the system removes.
- **Security**: workspace scoping on every endpoint (AC-73); uuid validation
  (AC-74); frozen untrusted text handled per "Untrusted inputs".
- **Accessibility**: all icon-only buttons (run, view, delete, case status)
  have `aria-label`s; Compare checkboxes are labelled with the run's version
  and date; the Compare modal traps focus and closes on Escape (AC-61);
  diff colouring is accompanied by `+`/`−` markers (not colour-only); charts
  and sparklines have an `aria-label` summarising the latest value, and the
  same numbers are shown as text in tiles/tables.
- **Observability**: the server logs one line at batch start (agent, version,
  cases_total, batch_id) and one at end (status, recall, precision,
  citation, passed/total, cost, duration_ms); a case error logs its message.
- **Privacy**: frozen diffs and PR bodies are copied into `eval_cases` inside
  the same workspace database as `pr_files`; they are deleted with the agent
  (AC-71). No data leaves the machine except the agent's own LLM calls.

## Inputs (provenance)

| Input | Provenance |
|---|---|
| Expectation type | [deterministic: `findings.accepted_at` → must_find, `dismissed_at` → must_not_flag] |
| Expectation file/lines/kind/severity/category/title | [reused: `findings` row at click time] |
| Case owner | [reused: `reviews.agent_id` of the finding's review] |
| `input_diff` | [reused: PR diff via `loadDiff` (git diff, fallback `pr_files` patches)], sliced to the finding's file [deterministic] |
| `input_meta.pr` | [reused: `pull_requests` + `repos` rows at click time] |
| Batch config snapshot | [reused: `agents` row + linked enabled skills at batch start] |
| `agent_version` | [reused: `agents.version`] |
| Actual findings, dropped findings, cost | [LLM: agent-under-test via `reviewPullRequest`], grounding [deterministic: reviewer-core gate] |
| All metrics, pass, alert text, prompt diff | [deterministic: code, no LLM] |

## Untrusted inputs

- The frozen diff, PR title/body and the source finding's title/rationale are
  foreign text. They are stored and replayed as **data**: at run time the PR
  body goes through the same untrusted-wrapping path reviewer-core already
  applies to `prDescription`, and the diff goes into the diff section only.
  No frozen text is ever placed in the system prompt.
- Skill bodies in the snapshot keep their existing trust handling (non-manual
  skills are delimiter-wrapped, server INSIGHTS 2026-09-21).
- The client renders finding text, case names, diff lines and system-prompt
  diff lines as plain text (no HTML injection); rationale may render via the
  existing safe Markdown component.
- Model output is untrusted: only findings that pass the Zod `Review` schema and
  the grounding gate count as grounded; `actual_output` is stored as data.

## Traceability

| Story | ACs | Edge cases / NFR | Source |
|---|---|---|---|
| US-1 | AC-1, AC-3, AC-5, AC-6, AC-9–AC-17 | E-2–E-5, E-26, E-27 | homework text step 2; FindingCard screenshot; `findings.ts`, `FindingCard.tsx` |
| US-2 | AC-1, AC-2, AC-4, AC-5, AC-7, AC-8 | E-1, E-7 | homework text; `findings.accepted_at/dismissed_at` |
| US-3 | AC-18–AC-27, AC-71, AC-72 | E-21–E-23, E-11 | AgentEditor Evals tab screenshot; `AgentEditor/constants.ts` |
| US-4 | AC-28–AC-42, AC-65, AC-66 | E-8–E-15, E-25, Reliability, Performance | homework step 3; `run-executor.ts`, `reviewPullRequest` |
| US-5 | AC-27, AC-43–AC-47, AC-49–AC-54 | E-16–E-19, E-24, Cost, Determinism | homework step 4; `grounding.ts`; agent detail screenshot |
| US-6 | AC-48, AC-51, AC-55–AC-61 | E-9, E-20, Accessibility | homework user story "compare"; Compare modal screenshot; `agent_versions` |
| US-7 | AC-62–AC-66 | E-25, Performance | homework step 6; Eval Dashboard screenshot; `vendor/ui/nav.ts` |
| US-8 | AC-46, AC-67–AC-70 | E-28 | course acceptance criteria; `server/AGENTS.md` (skip-worktree), server INSIGHTS (silent `.it` skips) |
| (all) | AC-73, AC-74 | Security, Privacy, Observability | repo conventions (workspace scoping, uuid params) |

Course acceptance checklist → spec:

- "Set has ≥ 8 cases" → user action via AC-3/AC-4 (NG5: no seed).
- "Case from a finding in one click; both types work" → AC-3, AC-4.
- "Changing the system prompt visibly moves recall/precision" → manual
  experiment (≥ 2 batches before/after a prompt edit, then a deliberately
  broken prompt) observed through AC-49, AC-52, AC-55–AC-58. This depends on
  the LLM, so it is a demo outcome and not a system AC.
- "Scoring makes zero LLM calls" → AC-46.
- "`pnpm verify:l06` is green" → AC-67–AC-70.

## Resolved clarifications (user, 2026-10-15)

| # | Question | Decision |
|---|---|---|
| 1 | AC-11: cap on the frozen file diff section | 200 000 characters |
| 2 | AC-26: "+ New eval case" | Kept as an instruction hint (no editor) |
| 3 | AC-42: stale-batch rule | Accepted, 30-minute threshold |
| 4 | AC-66: "Run all agents" | Sequential, agent name order |
| 5 | E-25: eval runs on disabled agents | Allowed from the agent page; "Run all agents" skips them |
| 6 | Compare modal: list cases whose pass/fail flipped | Not included (not on the screenshots) |
| 7 | `server/package.json` is `skip-worktree` locally | User runs `git update-index --no-skip-worktree server/package.json` and commits the `verify:l06` script |
