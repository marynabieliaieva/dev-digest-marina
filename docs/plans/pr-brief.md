# Implementation Plan: PR Brief

## Context
- Spec: `specs/2026-10-10-pr-brief/spec.md` (SPEC-02, Status: approved — header flipped by the user on 2026-10-10; no open `[NEEDS CLARIFICATION]`).
- Execution mode: **single-agent** — one implementer walks T1 → T8 in this exact order (a topological order of the DAG). Owned-path overlap between tasks is therefore harmless, but each task is verified on its own Done-condition before moving on.
- Modules touched:
  - `server/src/vendor/shared/contracts/brief.ts` + `client/src/vendor/shared/contracts/brief.ts` (`@devdigest/shared`, both copies, byte-identical)
  - `reviewer-core/src/brief/**` (new: pure prompt assembly + budget, single structured call, output validation) + `reviewer-core/src/index.ts` exports
  - `server/src/modules/brief/**` (new module) + `server/src/modules/index.ts` (registration)
  - `server/src/modules/project-context/{service,repository}.ts` (new workspace-wide document collector)
  - `server/src/db/seed.ts` (seeded `pr_brief` row for PR #482, for e2e only)
  - `client/src/lib/hooks/brief.ts` (new), `client/src/app/repos/[repoId]/pulls/[number]/_components/{PrBriefCard (new), OverviewTab, DiffTab}/**`, `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`, `client/src/components/diff-viewer/{DiffViewer,FileCard,CodeLine}/**`, `client/messages/en/{brief,prReview}.json`
  - `e2e/specs/13-pr-brief.flow.json` (new)
  - **Read-only consumers** (no change): `server/src/modules/intent` (`IntentService.get`, `extractIntentLinks`, `scrubText`), `server/src/modules/blast` (`BlastService.fromContainer(...).getBlast`), `server/src/modules/smart-diff/helpers.ts` (`classifyFile`), `server/src/modules/settings/feature-models.ts` (`resolveFeatureModel`), `server/src/db/schema/reviews.ts` (`prBrief` table already exists: `pr_id` PK → `pull_requests.id` ON DELETE CASCADE, `json jsonb`), `client/.../VerdictBanner` (props unchanged).
  - **No migration**: `pr_brief` already exists, and the SHA lives inside the JSON (spec Contracts: "No new columns").
- CLAUDE.md / INSIGHTS.md consulted: root `AGENTS.md`; `server/AGENTS.md` + `server/INSIGHTS.md`; `client/AGENTS.md` + `client/INSIGHTS.md`; `reviewer-core/CLAUDE.md` + `reviewer-core/INSIGHTS.md` (empty); `e2e/AGENTS.md` + `e2e/INSIGHTS.md` (empty); `.claude/skills/pr-self-review/routing.md` § "Authoring agents".
- Architectural constraints (from onion-architecture / frontend-ui-architecture / package conventions):
  - reviewer-core stays pure: no DB/HTTP/FS imports. All I/O (DB, GitHub, clone reads, blast) is done by the server and passed in as data. The LLM is an injected `LLMProvider`.
  - Server module files are named by role (`routes.ts`, `service.ts`, `repository.ts`, `helpers.ts`, `constants.ts`). DB access goes only through `repository.ts`. Routes stay thin: `getContext` → service → response.
  - `@devdigest/shared` is two hand-maintained copies. `brief.ts` must be edited in both and stay byte-identical (`server/INSIGHTS.md`: the copies have diverged elsewhere, so only mirror `brief.ts`).
  - Client: route-scoped component in `_components/PrBriefCard/` (`PrBriefCard.tsx` + `helpers.ts`/`styles.ts`/`index.ts`/`.test.tsx`); one hooks file per domain (`lib/hooks/brief.ts`); copy comes from `messages/en/*.json` via `next-intl`.
- **Repo precedents followed** (user rule: where a choice conflicts with an existing precedent, follow the precedent):
  - Prompt building and the single structured call live in **reviewer-core**, like intent (`reviewer-core/src/intent/{prompt,classify,finalize,composition}.ts`). The server module gathers facts, calls reviewer-core and persists. This rejects recommendation 1.
  - Token estimate `⌈chars/4⌉` and per-section stats follow `reviewer-core/src/intent/composition.ts`. Untrusted text is wrapped with `wrapUntrusted` from `reviewer-core/src/prompt.ts`.
  - `completeStructured` options mirror `classifyIntent`: `temperature: 0`, `maxRetries: 2`, `requireParameters: true`, `reasoning: 'off'`, no tools. The output shape is enforced by the Zod schema, not described in the system prompt (`reviewer-core/CLAUDE.md` gotcha).
  - Routes mirror `intent/routes.ts`: `IdParams` (a non-uuid id gives **422**, `server/INSIGHTS.md` 2026-09-29) and `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`.
  - Logging mirrors intent. The service takes an injectable log interface (`BriefLog`, like `IntentLog`) and routes pass a pino adapter, because the app logger is `false` under `NODE_ENV=test`.
  - Errors use `AppError(code, message, statusCode, details)` from `server/src/platform/errors.ts`. `scrubText` from `intent/helpers.ts` removes secrets from error text.
  - Client hooks mirror `lib/hooks/intent.ts`: query key `["pr-brief", prId, headSha]`, and the mutation writes its response into the query cache.
  - The auto-regeneration POST is in tension with `client/INSIGHTS.md` (2026-09-21: don't call a side-effecting mutation from an effect with a `useRef` once-guard under Strict Mode) and with the `useDeriveIntent` comment ("never an effect"). The spec requires it (AC-24), so the plan uses recommendation 5: a module-scope de-dupe `Set` plus a cache write in the `useMutation` **options** callbacks. The server-side `if_stale` mode and the lock keep it safe if it ever fires twice.
  - `null` means "not computed" (`server/INSIGHTS.md` Decisions): `cost_usd: null` when unknown, never `0`.
- Confirmed requirements / decisions (user answers, 2026-10-10):
  - Q1: the spec is approved.
  - Q2: verification is split.
    - A seeded `pr_brief` row for PR #482 (head SHA `a1b2c3d4e5f6`) plus a new e2e flow cover reload-shows-cached and focus-item → `tab=diff&file=…`.
    - RTL unit tests cover the rest: no POST when fresh (AC-27); `scrollIntoView` on the right element (AC-42/43, mocked); highlight ≥ 2 s (fake timers); the two-column grid style at ≥ 1,024 px (AC-30).
  - Q3: the linked issue comes from `extractIntentLinks(pull.body, repo)` plus `(await container.github()).getIssue(repo, n)`. Only the first link with `kind: 'linked_issue'` and `target.type === 'issue'` is used. GitHub being unavailable, or the call throwing, gives the `linked_issue/missing` gap. The full PR-detail fetch is **not** called.
  - Q4: `brief_generation_failed` → **HTTP 502**, `details: { reason: 'missing_key' | 'provider_error' | 'schema_invalid' }`. The client shows the Settings › Risk Brief hint iff `reason === 'missing_key'`.
  - Q5: single-agent.
  - Q6: no paired `test-writer` tasks. The implementer writes the tests listed in `Test strategy` inside its own task.
  - Recommendations 2–7 accepted. Recommendation 1 rejected (see below).

## Recommendations
- **rejected**: Keep prompt assembly in the server `brief` module (helpers.ts), reusing reviewer-core's `wrapUntrusted`. Rationale: fewer packages touched. Trade-off: it would break the intent precedent. The user chose to follow precedent, so the assembly and the call go to `reviewer-core/src/brief/**` (T2).
- **accepted**: Workspace-wide document collector in `ProjectContextService` (union of every enabled agent's effective attachments in agent creation order, first occurrence wins, reads confined to the clone, **no** `applyBudget`). Rationale: `resolveForRun` works on one agent and applies its own budget, which would fight the 8,000-token budget. Trade-off: a small additive change to project-context (T3).
- **accepted**: In-process per-PR generation lock (`Map<prId, Promise>` held by a module-level singleton in the brief service). Rationale: the app is local-first and runs as one process. Trade-off: it doesn't hold across multiple server processes (out of scope).
- **accepted**: A test-local LLM stub in `server/test/brief.it.test.ts` (can hold the call open, reject with `401 Bearer sk-…`, report `attempts > 1`) instead of extending the shared `MockLLMProvider`. Rationale: no blast radius on other suites. Trade-off: some extra test code.
- **accepted**: Strict-Mode-safe auto-regeneration. A module-scope `Set<string>` keyed `${prId}:${headSha}` is checked and filled **before** `mutate`. The cache write and the error state go in the `useMutation({ onSuccess, onError })` options, not in per-call callbacks. Rationale: `client/INSIGHTS.md` 2026-09-21. Trade-off: the module-level set lives until a full page load, which is what AC-24 asks for ("during that page load").
- **accepted**: Validate focus lines against the **full** blast snapshot (all callers of all downstream entries), not only the ≤ 50 callers sent to the model. Rationale: AC-23 says "the blast map". Trade-off: none material.
- **accepted**: Record budget cuts as `DataGap { source: 'budget', status: 'truncated' | 'dropped', reason: '<section name>[: <ref>]' }`. Rationale: AC-20 asks for them but doesn't name the source value. The contract's `'budget'` source fits.

## Test strategy
| Spec AC | Level (unit / integration / component / e2e) | Test file | Task |
|---|---|---|---|
| AC-1 | unit (contract) + `diff` of the two copies | `server/test/brief-contracts.test.ts` | T1 |
| AC-2 | unit (contract) | `server/test/brief-contracts.test.ts` | T1 |
| AC-3 | unit (contract) | `server/test/brief-contracts.test.ts` | T1 |
| AC-4 | integration | `server/test/brief.it.test.ts` | T4 |
| AC-5 | integration | `server/test/brief.it.test.ts` | T4 |
| AC-6 | integration (held stub LLM) | `server/test/brief.it.test.ts` | T4 |
| AC-7 | integration | `server/test/brief.it.test.ts` | T4 |
| AC-8 | integration | `server/test/brief.it.test.ts` | T4 |
| AC-9 | integration | `server/test/brief.it.test.ts` | T4 |
| AC-10 | integration | `server/test/brief.it.test.ts` | T4 |
| AC-11 | integration (concurrency) | `server/test/brief.it.test.ts` | T4 |
| AC-12 | integration | `server/test/brief.it.test.ts` | T4 |
| AC-13 | unit (single call, schemaName) + integration (count + attempts) | `reviewer-core/test/brief-generate.test.ts`, `server/test/brief.it.test.ts` | T2, T4 |
| AC-14 | integration | `server/test/brief.it.test.ts` | T4 |
| AC-15 | integration | `server/test/brief.it.test.ts` | T4 |
| AC-16 | unit | `reviewer-core/test/brief-prompt.test.ts` | T2 |
| AC-17 | unit (prompt has no body lines) + integration (`MARKER_7f3a` absent from captured request) | `reviewer-core/test/brief-prompt.test.ts`, `server/test/brief.it.test.ts` | T2, T4 |
| AC-18 | unit | `reviewer-core/test/brief-prompt.test.ts` | T2 |
| AC-19 | integration | `server/test/project-context-workspace.it.test.ts` (collector), `server/test/brief.it.test.ts` (order in `inputs`) | T3, T4 |
| AC-20 | unit (gap builder) + integration | `server/test/brief-helpers.test.ts`, `server/test/brief.it.test.ts` | T4 |
| AC-21 | integration | `server/test/brief.it.test.ts` | T4 |
| AC-22 | integration | `server/test/brief.it.test.ts` | T4 |
| AC-23 | unit | `reviewer-core/test/brief-validate.test.ts` | T2 |
| AC-23a | unit | `reviewer-core/test/brief-validate.test.ts` | T2 |
| AC-24 | unit (hook + component, Strict Mode) | `client/src/lib/hooks/brief.test.ts`, `.../PrBriefCard/PrBriefCard.test.tsx` | T5 |
| AC-25 | unit (fake timers, 409 → poll) | `client/src/lib/hooks/brief.test.ts` | T5 |
| AC-26 | component (RTL) | `.../PrBriefCard/PrBriefCard.test.tsx` | T5 |
| AC-27 | unit (fresh response → zero POST) + e2e (seeded brief visible after reload) | `client/src/lib/hooks/brief.test.ts`, `e2e/specs/13-pr-brief.flow.json` | T5, T8 |
| AC-28 | unit | `client/src/lib/hooks/brief.test.ts` | T5 |
| AC-29 | component (RTL) | `.../PrBriefCard/PrBriefCard.test.tsx` | T5 |
| AC-30 | component (order + grid style) + e2e (card text visible above Intent) | `.../OverviewTab/OverviewTab.test.tsx`, `e2e/specs/13-pr-brief.flow.json` | T7, T8 |
| AC-31 | component | `.../PrBriefCard/PrBriefCard.test.tsx` | T5 |
| AC-32 | component | `.../PrBriefCard/PrBriefCard.test.tsx` | T5 |
| AC-33 | component | `.../PrBriefCard/PrBriefCard.test.tsx` | T5 |
| AC-34 | component | `.../PrBriefCard/PrBriefCard.test.tsx` | T5 |
| AC-35 | component | `.../PrBriefCard/PrBriefCard.test.tsx` | T5 |
| AC-36 | component | `.../PrBriefCard/PrBriefCard.test.tsx` | T5 |
| AC-37 | unit (href builder) + component (router) + page-level + e2e | `.../PrBriefCard/PrBriefCard.test.tsx`, `.../OverviewTab/OverviewTab.test.tsx`, `e2e/specs/13-pr-brief.flow.json` | T5, T7, T8 |
| AC-38 | component | `.../OverviewTab/OverviewTab.test.tsx` | T7 |
| AC-39 | component | `.../PrBriefCard/PrBriefCard.test.tsx` | T5 |
| AC-40 | component | `.../PrBriefCard/PrBriefCard.test.tsx` | T5 |
| AC-41 | component (test bundle) + grep | `.../PrBriefCard/PrBriefCard.test.tsx` | T5 |
| AC-42 | component (mocked `scrollIntoView`, both orders, fake timers) + e2e (file visible) | `.../DiffTab/DiffTab.test.tsx`, `e2e/specs/13-pr-brief.flow.json` | T6, T8 |
| AC-43 | component (line row targeted; `9999` falls back to header) | `.../DiffTab/DiffTab.test.tsx` | T6 |
| AC-44 | component | `.../DiffTab/DiffTab.test.tsx` | T6 |
| AC-45 | integration (injected `BriefLog`) | `server/test/brief.it.test.ts` | T4 |

(`.../` = `client/src/app/repos/[repoId]/pulls/[number]/_components/`.)

## Tasks

### Task T1: Extend the `brief.ts` contract in both vendored copies
- Agent: implementer
- Requirement-ID: AC-1, AC-2, AC-3 (spec "Contracts")
- Depends-on: none
- Owned paths: [`server/src/vendor/shared/contracts/brief.ts`, `client/src/vendor/shared/contracts/brief.ts`, `server/test/brief-contracts.test.ts`]
- Skills to apply: [`zod` — full (a new shared contract imported by server, client and reviewer-core)]
- Key constraints:
  - Add `ReviewFocusItem = z.object({ file: z.string(), line: z.number().int().min(1), reason: z.string() })`.
  - Add `PrBriefGeneration = z.object({ summary, risks: z.array(Risk), review_focus: z.array(ReviewFocusItem) })` with every field required. No `.optional()`, `.nullish()` or `.default()` (strict structured output, like `IntentClassification`).
  - Add `DataGap`, `InputSection`, `PrBriefDropped`, `PrBriefResponse` and `PrBriefRequest` (`{ mode: z.enum(['refresh','if_stale']).default('refresh') }`, request-only, so `.default` is allowed) exactly as in spec § Contracts, with enum values verbatim.
  - Replace the existing `PrBrief` with the spec shape: `intent: Intent.nullable()`, `blast: BlastRadius.nullable()`, `risks`, `history`, `summary`, `review_focus`, `head_sha`, `generated_at`, `provider`, `model`, `tokens_in`, `tokens_out` (int), `cost_usd: z.number().nullable()`, `attempts` (int), `data_gaps`, `inputs`, `dropped`. Export `type X = z.infer<typeof X>` for each.
  - Write the server copy, then copy the **whole file** to the client copy. `diff` must print nothing. Don't touch any other vendored file (they have diverged on purpose, `server/INSIGHTS.md`).
  - Check `grep -rn "PrBrief\b" server/src client/src reviewer-core/src` for existing consumers of the old `PrBrief` shape. Today there are none outside the contracts, but re-check.
- Acceptance criteria:
  - `PrBrief.parse(fixture)` succeeds for a fixture with `intent: null`, `blast: null`, `summary`, `review_focus: [{file:'src/a.ts',line:12,reason:'x'}]`. It throws when `head_sha` is removed (AC-2).
  - `ReviewFocusItem` rejects `line: 0` and `line: 1.5`.
  - `PrBriefGeneration.safeParse({ summary:'s', risks:[] })` fails (no `review_focus`) (AC-3).
  - `PrBriefRequest.parse({})` gives `{ mode: 'refresh' }`.
  - `diff server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts` exits 0 with no output (AC-1).
- Done-condition: `scripts/check.sh server test/brief-contracts.test.ts && diff server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts && scripts/check.sh client --typecheck-only && scripts/check.sh reviewer-core --typecheck-only`

### Task T2: reviewer-core brief engine (prompt + budget, single call, output validation)
- Agent: implementer
- Requirement-ID: AC-13, AC-16, AC-17, AC-18, AC-20 (model-facing gap note), AC-23, AC-23a; NFR-S2, NFR-S4
- Depends-on: [T1]
- Owned paths: [`reviewer-core/src/brief/**` (new: `prompt.ts`, `ranges.ts`, `generate.ts`, `validate.ts`), `reviewer-core/src/index.ts`, `reviewer-core/test/brief-prompt.test.ts`, `reviewer-core/test/brief-generate.test.ts`, `reviewer-core/test/brief-validate.test.ts`]
- Skills to apply: [`onion-architecture` — digest, `zod` — digest, `security` — digest (untrusted text into a prompt)]
- Key constraints:
  - Follow the intent precedent file by file:
    - `prompt.ts` ≈ `intent/prompt.ts` + `composition.ts`;
    - `generate.ts` ≈ `intent/classify.ts`;
    - `validate.ts` ≈ `intent/finalize.ts`.

    Export from `src/index.ts` next to the intent exports: `buildBriefPrompt`, `generateBrief`, `validateBriefOutput`, `newSideRanges`, `BRIEF_TOKEN_BUDGET`, plus the input types.
  - **Pure:** no DB/HTTP/FS imports. Inputs arrive as plain data (title, body, intent snapshot + stale flag, files `{ path, role, additions, deletions, patch | null }`, blast summary/degraded/reason/callers, linked issue, spec docs `{ path, content }`, pre-computed gap notes).
  - `ranges.ts`:
    - `newSideRanges(patch)` reads **only** lines matching `^@@ -\d+(,\d+)? \+(\d+)(,(\d+))? @@`. New-side range = `[c, c+d-1]`; `d` defaults to 1; `d = 0` gives no range.
    - A `null` patch gives `[]`.
    - It never returns or keeps body lines.
  - `prompt.ts` sections and limits:
    - Sections in this exact order and with these names: `pr`, `intent`, `diff`, `blast`, `linked_issue`, `specs`. The `specs` section has one `InputSection` per doc, `ref = path`.
    - `pr`: title cut to 300 chars, body cut to 4,000 chars.
    - `diff`: files sorted by `additions + deletions` desc, first 100 listed as `path [role] +a/-d ranges: c1-e1, …`, then a count line for the rest.
    - `blast`: ≤ 50 callers in the given order.
    - `linked_issue`: body ≤ 4,000 chars.
  - Budget (AC-18):
    - `est = ⌈chars/4⌉` over the **full** system + user message text.
    - Fill sections in priority order. The first one that doesn't fit is cut: text at a char boundary, lists (`diff` files, `blast` callers, `specs` docs) at an item boundary. Every later section is `dropped`.
    - Return `{ messages, inputs: InputSection[], budgetGaps: DataGap[], estTokens }` with `estTokens ≤ 8000` always.
    - A section with no data (e.g. intent absent) is recorded as `missing`/`unavailable` with `est_tokens: 0`, not as `dropped`.
  - Every author-controlled text (PR title/body, intent text, issue, spec docs, file paths) goes into the **user** message via `wrapUntrusted(label, content)`. The system prompt holds only instructions plus the existing SECURITY/injection wording style from `INTENT_SYSTEM_PROMPT`. It must not describe the JSON shape.
  - The data-gaps plain-text note (AC-20) is its own short user-message section built from caller-supplied gap notes. The stale-intent flag is stated in it.
  - `generate.ts`: exactly one `llm.completeStructured({ model, schema: PrBriefGeneration, schemaName: 'PrBriefGeneration', messages, temperature: 0, maxRetries: 2, requireParameters: true, reasoning: 'off' })`. No tools, no second call, no retry loop around it. Return `{ output, tokensIn, tokensOut, costUsd, attempts }` from the result.
  - `validate.ts` (AC-23, in this order):
    1. Normalise each path by stripping leading `./` and `/`. Matching is exact and case-sensitive.
    2. Known files = PR paths ∪ blast caller files ∪ changed-symbol files.
    3. Remove unknown `file_refs` entries; drop a risk whose list becomes empty.
    4. Drop a focus item whose file is unknown, or whose line is neither inside a new-side range of that PR file nor equal to a blast caller line in that file.
    5. Stable-sort risks high → medium → low and cap at 8; cap focus items at 6.
    6. Count everything removed, including capped items, in `dropped`.
  - Input is `{ prFiles: Map<string, Array<[number, number]>>, blastFiles: Set<string>, callerLines: Map<string, Set<number>> }`. Output is `{ summary, risks: Risk[], review_focus, dropped }`.
  - An all-invalid response returns the summary with empty lists (AC-23a).
- Acceptance criteria:
  - `brief-prompt.test.ts`:
    - `inputs.map(i => i.name)` keeps the AC-16 order.
    - A patch containing `+const MARKER_7f3a = 1;` and ` context` lines: the joined `messages` text does not contain `MARKER_7f3a` or `context`, and does contain the range numbers (e.g. `10-13`) (AC-17).
    - A fixture with ~30k tokens of specs gives `estTokens ≤ 8000` over system + user, `specs` entries `truncated`/`dropped`, and `pr`/`intent`/`diff` `used` (AC-18).
    - 120 files: 100 listed plus a count line for 20.
    - Title is cut at 300 chars and body at 4,000.
  - `brief-generate.test.ts`: a fake `LLMProvider` records exactly 1 `completeStructured` call with `schemaName === 'PrBriefGeneration'`, and the returned `attempts` equals the fake's `attempts` (e.g. 3) (AC-13).
  - `brief-validate.test.ts`:
    - The spec AC-23 example (`src/ghost.ts` risk, `src/a.ts:999` outside ranges, `./src/a.ts:12` inside): risk dropped, `:999` dropped, `src/a.ts:12` kept. Expected counts: `dropped.risks` 1 (the ghost-only risk), `dropped.risk_file_refs` 1 (its `src/ghost.ts` entry), `dropped.review_focus` 1 (`:999`), matching the spec's "1/1/1".
    - 10 risks give 8, ordered high → medium → low with model order kept within a severity.
    - 9 focus items give 6.
    - A blast-only file with a caller line is kept.
    - A pure-deletion file (`+c,0`) focus item is dropped (E9).
    - All-invalid gives `risks: []` and `review_focus: []` with the summary kept (AC-23a).
- Done-condition: `scripts/check.sh reviewer-core test/brief-prompt.test.ts test/brief-generate.test.ts test/brief-validate.test.ts && scripts/check.sh server --typecheck-only`

### Task T3: Workspace-wide attached-document collector in project-context
- Agent: implementer
- Requirement-ID: AC-19 (spec gaps E5); accepted recommendation 2
- Depends-on: [T1]
- Owned paths: [`server/src/modules/project-context/service.ts`, `server/src/modules/project-context/repository.ts`, `server/test/project-context-workspace.it.test.ts`]
- Skills to apply: [`onion-architecture` — digest, `drizzle-orm-patterns` — digest, `security` — digest (confined file reads)]
- Key constraints:
  - Add a new public method, e.g. `collectWorkspaceDocs(workspaceId, repoId): Promise<{ clone: boolean; docs: Array<{ path; status: 'ok'|'missing'|'too_large'|'unreadable'; content: string | null; bytes }> }>`. **Do not** change `resolveForRun` or `applyBudget` behaviour (the review path depends on them).
  - Agents: only `enabled` agents of the workspace, ordered by `createdAt` ascending (then `id` for ties). Per agent, reuse the same effective-path logic as `resolveForRun`: `repo.getAgentPaths`, then `agentsRepo.linkedSkills(agentId)` filtered `l.enabled && l.skill.enabled`, `getSkillPathsMap`, `mergeEffective`.
  - Concatenate across agents and keep the first occurrence of each path.
  - Read each path with the existing `isSafeRelPath` + `matchesAny(projectContextGlobs)` + `readDocConfined` from the **PR's repo** clone. The 64 KB limit comes from `readDocConfined` (`too_large`).
  - No clone: return `clone: false` and don't throw. This mirrors `cloneRootOrThrow`'s lookup but must not throw.
  - Never throw for per-document problems; record a status instead. No token budgeting here (the brief engine applies the 8,000 budget).
  - Any new DB query (list enabled agents by workspace, ordered) goes in `repository.ts`, not the service.
- Acceptance criteria:
  - Setup: agent A (enabled, created first) attaches `specs/a.md`; agent B (disabled) attaches `specs/b.md`; skill S (enabled, linked to A with an enabled link) attaches `specs/a.md` and `specs/c.md`. The returned paths are `['specs/a.md', 'specs/c.md']`.
  - A missing file gives `status: 'missing'`. A > 64 KB file gives `too_large`. A path outside the globs or unsafe gives `unreadable`. A repo with no clone gives `clone: false` and does not throw.
  - Existing project-context integration tests stay green.
- Done-condition: `scripts/check.sh server --it test/project-context-workspace.it.test.ts test/project-context-run.it.test.ts`

### Task T4: Server `brief` module (GET/POST, fact assembly, lock, persistence, logs)
- Agent: implementer
- Requirement-ID: AC-4 … AC-15, AC-17, AC-19 … AC-22, AC-45; NFR-P1, NFR-S1 … S4, NFR-R1, NFR-R2; edge cases E1–E5, E7, E8, E12–E15, E17, E20, E22, E23
- Depends-on: [T1, T2, T3]
- Owned paths: [`server/src/modules/brief/**` (new: `routes.ts`, `service.ts`, `repository.ts`, `helpers.ts`, `constants.ts`), `server/src/modules/index.ts`, `server/test/brief.it.test.ts`, `server/test/brief-helpers.test.ts`, `server/test/routes-smoke.test.ts` (only if it enumerates registered routes and breaks)]
- Skills to apply: [`onion-architecture` — full (new server module + container wiring), `fastify-best-practices` — digest, `drizzle-orm-patterns` — digest, `security` — digest (new endpoints, untrusted input, secret scrubbing)]
- Key constraints:
  - Register `brief` in `server/src/modules/index.ts` (one import, one entry).
  - Routes mirror `intent/routes.ts`:
    - `GET /pulls/:id/brief` and `POST /pulls/:id/brief` use `schema: { params: IdParams, body: PrBriefRequest }` (an empty body becomes `refresh`) and `getContext(app.container, req)` for `workspaceId`.
    - POST also has `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`.
    - The response is `PrBriefResponse`.
  - `repository.ts` owns all SQL:
    - `getPullForWorkspace(workspaceId, prId)` (workspace-scoped, null → `NotFoundError`, giving 404);
    - list `pr_files` (path, additions, deletions, patch);
    - `getBrief(prId)` and `upsertBrief(prId, json)` on `t.prBrief` (`onConflictDoUpdate` on `prId`).
    - Parse the stored JSON with `PrBrief.safeParse`. An invalid or legacy row is treated as `brief: null`.
  - GET (AC-4/5/6):
    - DB only. No `container.llm`, no `container.github`, no blast call.
    - `stale = brief != null && brief.head_sha !== pull.headSha`.
    - `generating = lock.has(prId)`.
  - Lock (AC-11):
    - A module-scope `Map<string, Promise<unknown>>` shared by every service instance.
    - Checked and set synchronously before any `await` in POST. A busy lock throws `new AppError('brief_in_progress', …, 409)`.
    - Always released in `finally`.
  - POST `if_stale` (AC-9/10) returns the stored brief with no lock and no model call when the brief exists and is fresh. Otherwise it runs the same path as `refresh`.
  - Generation order:
    1. Resolve the model: `resolveFeatureModel(container, workspaceId, 'risk_brief')` → `container.llm(choice.provider)`. A missing key throws here and becomes 502 `missing_key`. No model name literals anywhere in `modules/brief/**` (AC-14).
    2. Collect facts. All reads are in-process and none of them may fail the brief:
       - `IntentService.get` → use only when `status === 'ready'`; `stale` comes from the record;
       - `BlastService.fromContainer(container).getBlast(...)` inside try/catch;
       - `classifyFile` for roles;
       - `extractIntentLinks` + `github().getIssue` for the first issue link (Q3);
       - `ProjectContextService.collectWorkspaceDocs(workspaceId, pull.repoId)` (T3).
    3. Build gaps with a pure helper in `helpers.ts` (AC-20 table + budget gaps from T2).
    4. `buildBriefPrompt` → `generateBrief` (exactly once) → `validateBriefOutput`.
    5. Persist and return.
  - Head SHA: the brief stores the `pull.headSha` read **at the start** of generation (E13).
  - Provenance (AC-22): `intent` = the intent object used (or `null`), `blast` = `BlastRadius` used (or `null`), `history: { history: [] }`. Validate with `PrBrief.parse` before the upsert.
  - Failure (AC-15):
    - Any error from model resolution or `generateBrief` throws `new AppError('brief_generation_failed', scrubText(msg), 502, { reason })`.
    - `reason` mapping: missing key or `ConfigError` → `missing_key`; Zod / schema failure after repair → `schema_invalid`; anything else → `provider_error`.
    - **Never upsert on failure.** The previous row stays untouched.
  - Logging (AC-45):
    - The service takes `BriefLog { tool(msg, data); error(msg, data) }`; routes pass a pino adapter like `pinoIntentLog`.
    - One entry before the call: `{ call:'pr_brief', provider, model, sections:[{name, ref, status, est_tokens}], est_tokens, budget: 8000 }`.
    - One entry after: `{ call:'pr_brief', tokens_in, tokens_out, cost_usd, attempts, duration_ms, dropped }`.
    - Never log section text, PR body, issue text or doc content.
  - Tests: build the app the way `server/test/intent.it.test.ts` does (`startPg`, `seed`, `buildApp` with mocks). Use a **test-local** `LLMProvider` stub that can hold the call open (a deferred promise), reject with `new Error('401 Bearer sk-test-123')`, and return a fixed `attempts`. Don't edit `server/src/adapters/mocks.ts`.
  - Mock GitHub and LLM call counters are asserted. Run `.it` alone and check that the output shows executed (not skipped) tests (`server/INSIGHTS.md` 2026-09-21, 2026-10-03).
- Acceptance criteria (each is an assertion in `server/test/brief.it.test.ts` unless noted):
  - GET with a stored brief returns it, with `llm.calls.length === 0` and zero GitHub calls (AC-4).
  - Brief for `abc`, then the PR row updated to `def`: GET returns `stale: true`. With no brief: `brief: null, stale: false` (AC-5).
  - While the stub LLM is held: GET returns `generating: true`. Two concurrent POSTs: one 200, one 409 with `error.code === 'brief_in_progress'`, and the stub's call count is 1 (AC-6, AC-11).
  - PR of another workspace: GET and POST give 404. `:id = 'nope'` gives 422 (AC-7).
  - POST `{}`: then GET returns the same `generated_at`, `brief.head_sha === pull.headSha`, and `stale: false` (AC-8).
  - Fresh brief + POST `{mode:'if_stale'}`: 0 LLM calls and the same `generated_at`. Stale brief + `if_stale`: 1 call and the new `head_sha` (AC-9, AC-10).
  - 11 sequential POSTs within a minute: the 11th is 429 (AC-12).
  - Per POST: `completeStructured` count = 1, `schemaName === 'PrBriefGeneration'`, and stored `attempts` = stub `attempts` (3) (AC-13).
  - `feature_models.risk_brief = {provider:'openai', model:'x-test'}` set through the settings path used in `settings-models.it.test.ts`: the captured request has `model === 'x-test'`, and the stored `provider/model` are `openai/x-test`. `grep -rnE "gpt-|claude-|o[0-9]-" server/src/modules/brief` prints nothing (AC-14).
  - Stored brief A, stub rejects `401 Bearer sk-test-123`: POST gives 502, `error.code === 'brief_generation_failed'`, the body has no `sk-`, `details.reason === 'provider_error'`, and GET still returns A. With no API key: `details.reason === 'missing_key'` (AC-15).
  - A fixture patch with `+const MARKER_7f3a = 1;`: the captured request messages contain no `MARKER_7f3a` and do contain the hunk range numbers (AC-17).
  - Specs: the T3 fixture (A enabled, B disabled, S on A) gives `inputs` entries `name:'specs'` with refs `['specs/a.md','specs/c.md']` in order (AC-19).
  - PR with no intent row and repo-intel flag off: `data_gaps` contains `{source:'intent',status:'missing'}` and `{source:'blast_radius',status:'degraded'}` (AC-20).
  - No intent and the blast service throws (stubbed via `container.repoIntel`): POST 200 with a non-empty `summary`, plus a `blast_radius/missing` gap (AC-21).
  - Ready intent row: the stored `brief.intent.summary` equals the row's summary (AC-22).
  - Injected `BriefLog`: exactly one `tool` entry with `call:'pr_brief'` before the call (with `budget: 8000`, `sections`, `est_tokens`) and one after (with `tokens_in`, `tokens_out`, `cost_usd`, `attempts`, `duration_ms`, `dropped`). `JSON.stringify` of both entries does not contain the PR body sentinel (AC-45).
  - `server/test/brief-helpers.test.ts` (unit) covers the gap builder: intent `failed` → missing; intent `stale` → stale; empty body → `pr_description/missing`; no linked issue → `linked_issue/missing`; no docs or no clone → `specs/missing`.
- Done-condition: `scripts/check.sh server test/brief-helpers.test.ts && scripts/check.sh server --it test/brief.it.test.ts`

### Task T5: Client brief hooks + `PrBriefCard` + i18n copy
- Agent: implementer
- Requirement-ID: AC-24 … AC-29, AC-31 … AC-37 (card side), AC-39 … AC-41; NFR-A1 … A5; E12, E16, E18, E21
- Depends-on: [T1, T4]
- Owned paths: [`client/src/lib/hooks/brief.ts`, `client/src/lib/hooks/brief.test.ts`, `client/src/lib/hooks/index.ts` (only if it re-exports domain hooks), `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/**`, `client/messages/en/brief.json`]
- Skills to apply: [`frontend-ui-architecture` — digest, `react-best-practices` — digest, `next-best-practices` — digest, `react-testing-library` — full (test files)]
- Key constraints:
  - Hooks (`lib/hooks/brief.ts`, mirroring `lib/hooks/intent.ts`):
    - `usePrBrief(prId, headSha)`: key `["pr-brief", prId, headSha]`, `enabled: !!prId && !!headSha` (AC-28: the page passes `headSha` only after `usePullDetail` has resolved).
    - `useGenerateBrief(prId, headSha)`: `api.post<PrBriefResponse>(\`/pulls/${prId}/brief\`, { mode })`. The cache write (`setQueryData`) and error capture go in the `useMutation` **options**.
  - Auto-regeneration (AC-24, accepted recommendation 5):
    - A module-scope `const attempted = new Set<string>()` keyed `${prId}:${current_head_sha}`.
    - The effect fires `mutate({ mode:'if_stale' })` only when `brief && stale && !generating && !attempted.has(key)`, and adds the key **before** calling `mutate`.
    - No `useRef` once-guard. A failure leaves the key in the set, so there is no retry (NG8).
    - Export a test-only reset helper (e.g. `__resetBriefAutoRegen()`).
  - 409 handling (AC-25): on `ApiError` with status 409 (`brief_in_progress`) from either mode, poll GET every 2,000 ms (`refetchInterval`) until `generating === false`, then render.
  - `generating: true` from GET also drives the "Updating…"/skeleton state and polling.
  - Card states:
    - `brief: null` and not pending: `unavailable` text plus a Generate button, which sends `{mode:'refresh'}`. No auto POST (AC-29, AC-31).
    - `brief: null` and pending/generating: skeleton for summary, risks and focus; Generate `disabled` (AC-32).
    - `brief` present and pending: the previous brief stays visible with an "Updating…" badge inside `aria-live="polite"`, a loading indicator, and refresh `disabled` (AC-26, NFR-A5).
  - Header line `Generated for <sha7> · <model>`, plus the cost only when `cost_usd !== null`. The refresh icon button has an accessible name from i18n.
  - The data-gaps note renders one phrase per gap (source + status + reason) from i18n keys and is omitted when the list is empty (AC-33).
  - Risks (AC-34, AC-35):
    - The severity icon colour comes from existing tokens: high = critical, medium = warning, low = muted. Use the existing CSS variables used by the severity components; don't invent hex values.
    - Text plus `aria-label` containing the severity word.
    - Each row is a `<button aria-expanded>` toggled by click/Enter/Space that shows/hides `explanation`.
  - Navigation (AC-37, AC-39):
    - The card gets `changedFiles: string[]` and `onNavigate(href: string)` props. A pure `buildDiffHref(repoId, number, file, line?)` in `PrBriefCard/helpers.ts` returns `/repos/${repoId}/pulls/${number}?tab=diff&file=${encodeURIComponent(file)}[&line=${line}]`.
    - Focus items include `&line=`; risk file refs don't.
    - A file not in `changedFiles` renders the "File not in this PR's diff" label and is not clickable.
    - Focus item accessible name contains `file:line` (NFR-A4). Long paths get `title={fullPath}` (E21).
  - All model text renders as plain React text nodes. No `dangerouslySetInnerHTML` and no Markdown.
  - Error state (AC-40): the error text is the server's `error.message`, with a Retry button (re-sends the last mode) and the previous brief kept visible. `details.reason === 'missing_key'` also shows the Settings › Risk Brief hint linking to the settings page.
  - i18n (AC-41):
    - All copy comes from the `brief` namespace via `useTranslations("brief")`.
    - Reuse `block.intent`, `block.blast`, `block.risks`, `noRisks`, `unavailable` and `unavailableHint`.
    - Add new keys under `card.*`: title, summary, reviewFocus, noFocus = "No review focus suggested.", generate, refresh, updating, generatedFor, cost, gaps.*, notInDiff = "File not in this PR's diff", severity.*, errors.*, retry, settingsHint.
    - Don't remove existing keys (other code may use them).
    - Don't apply `text-transform: uppercase` to labels that e2e matches (`client/INSIGHTS.md`).
- Acceptance criteria:
  - `brief.test.ts`:
    - A stale response gives exactly 1 POST with `{mode:'if_stale'}`, even under `<React.StrictMode>` and after a forced re-render.
    - After a rejected POST, a re-render sends no second POST (AC-24).
    - 409, then GET `generating:false`: the new brief is in the cache (fake timers, 2,000 ms poll) (AC-25).
    - A fresh response gives 0 POSTs (AC-27).
    - The query is disabled while `headSha` is undefined, and a changed `headSha` refetches (AC-28).
  - `PrBriefCard.test.tsx` (rendered with a test message bundle):
    - Covers AC-26, 29, 31, 32, 33 (summary, gap text, `sha7`, and refresh calls the mutation with `refresh`), 34 (`aria-label` contains "high", critical token; empty list gives "No notable risks flagged."), 35, and 36 (`src/config.ts:12 — live key committed`).
    - AC-37: `onNavigate` is called with `…?tab=diff&file=src%2Fconfig.ts&line=12`; a risk ref gives a URL without `line`.
    - AC-39: a blast-only item shows "File not in this PR's diff" and clicking it doesn't call `onNavigate`.
    - AC-40: error text, Retry, previous summary visible, Settings hint when `missing_key`.
  - `grep -nE '>[A-Z][a-z]+ [a-z]' client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx` prints nothing (no literal English JSX copy) (AC-41).
- Done-condition: `scripts/check.sh client src/lib/hooks/brief.test.ts PrBriefCard`

### Task T6: Files changed deep-link (`file` / `line`) in DiffTab + diff-viewer
- Agent: implementer
- Requirement-ID: AC-42, AC-43, AC-44; E19; "Untrusted inputs" (query params)
- Depends-on: [T1]
- Owned paths: [`client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/**`, `client/src/components/diff-viewer/DiffViewer/**`, `client/src/components/diff-viewer/FileCard/**`, `client/src/components/diff-viewer/CodeLine/**`, `client/src/components/diff-viewer/index.ts`, `client/messages/en/prReview.json`]
- Skills to apply: [`frontend-ui-architecture` — digest, `react-best-practices` — digest, `react-testing-library` — full (test files)]
- Key constraints:
  - `DiffTab` gets new optional props `focusFile?: string | null` and `focusLine?: number | null`. The page wires them in T7; DiffTab does **not** read `useSearchParams` itself.
  - `focusLine` must be a positive integer, otherwise it is ignored (the page parses it, and DiffTab re-checks with `Number.isInteger(n) && n >= 1`).
  - `focusFile` is matched exactly against `files[].path`. No match gives a notice `t("deepLink.notInDiff")` = "File not in this PR's diff" above the diff, and the diff renders normally (AC-44).
  - The target `FileCard` opens even if it would start collapsed. Use an explicit `forceOpen`/`focus` prop; FileCard already has `open` state plus `expandSignal`, so extend it rather than adding a parallel mechanism. This must work in **both** "Smart order" (files inside `SmartDiffGroup`) and "Original order".
  - Scroll and highlight:
    - After the diff renders (effect after open), call `scrollIntoView({ block: 'center' })` on the target. That is the `CodeLine` row whose **new-side** line number equals `focusLine` when rendered (AC-43), otherwise the file header (AC-42, fallback for `line=9999`).
    - Apply a highlight style for ≥ 2,000 ms via a timeout, cleared on unmount.
    - Expose `data-deeplink-target="true"` on the highlighted element for tests and e2e.
  - Existing props and behaviour of `DiffViewer`/`FileCard`/`CodeLine` stay unchanged when no focus props are passed. Run their existing tests.
  - `prReview.json`: add only the new `deepLink.*` key(s).
- Acceptance criteria (`DiffTab.test.tsx`, with `Element.prototype.scrollIntoView = vi.fn()` and fake timers):
  - `focusFile="src/b.ts"` in original order and again in smart order: that FileCard is expanded, `scrollIntoView` is called on its header, and the header has the highlight attribute at t = 1,999 ms and loses it after it expires (AC-42).
  - `focusLine=12`, where new line 12 is in a hunk: `scrollIntoView` is called on the row for new line 12, which is highlighted (AC-43).
  - `focusLine=9999`: `scrollIntoView` is called on the file header (AC-43 fallback).
  - `focusLine` NaN/0: ignored.
  - `focusFile="src/ghost.ts"`: the notice "File not in this PR's diff" is visible and the file list still renders (AC-44).
  - No focus props: the existing DiffTab and FileCard tests pass unchanged.
- Done-condition: `scripts/check.sh client DiffTab FileCard && scripts/check.sh client --related src/components/diff-viewer/CodeLine/CodeLine.tsx src/components/diff-viewer/DiffViewer/DiffViewer.tsx`

### Task T7: Overview wiring — VerdictBanner + PrBriefCard + two-column cards; page passes deep-link params
- Agent: implementer
- Requirement-ID: AC-28 (page side), AC-30, AC-37 (page-level reachability), AC-38; US-9
- Depends-on: [T5, T6]
- Owned paths: [`client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/**` (incl. new `OverviewTab.test.tsx`, `helpers.ts`), `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`]
- Skills to apply: [`frontend-ui-architecture` — digest, `react-best-practices` — digest, `next-best-practices` — digest, `react-testing-library` — full (test files)]
- Key constraints:
  - `OverviewTab` gets new props from `page.tsx`: `reviews` (the page's existing `usePrReviews` data; don't add a second fetch), `changedFiles` (`pr.files.map(f => f.path)`), `prNumber`, and `onNavigate` (`router.replace` / `router.push` of the href).
  - `headSha` is passed only from the resolved `pr` (already the case). It drives the `usePrBrief` key (AC-28).
  - Render order (AC-30): VerdictBanner (conditional), PrBriefCard, a grid wrapper with `IntentCard` + `BlastRadiusCard`, then the Description section.
    - Grid: `display:grid; grid-template-columns: 1fr 1fr` at ≥ 1,024 px, a single column otherwise.
    - Implement with a CSS media query in `styles.ts`, or a class in a co-located CSS module if inline styles can't express it. Match how the repo already does responsive styles: grep for `@media` / `matchMedia` before choosing.
    - The grid must be testable in jsdom via a class or `data-layout="two-col"` attribute plus the stylesheet rule.
  - `IntentCard` and `BlastRadiusCard` themselves are untouched (NG4).
  - VerdictBanner selection (AC-38) is a pure helper `selectLatestVerdictReview(reviews)` in `OverviewTab/helpers.ts`:
    - the latest review with `kind === 'review'` and non-null `verdict` (newest first, as the page already orders them);
    - `findingsCount = findings.length`;
    - `blockers` = findings with `severity === 'CRITICAL'` and not dismissed, using the same predicate the Agent runs tab uses. Grep `FindingsTab`/`ReviewRunAccordion` for it and reuse it, don't re-derive.
    - No qualifying review: no banner. VerdictBanner props unchanged.
  - `page.tsx`: read `search.get("file")` and `search.get("line")` (`line` parsed with `Number.parseInt`, kept only if an integer ≥ 1) and pass them to `<DiffTab focusFile focusLine>`. Keep the existing `?tab` mechanics (`setParam`/`router.replace`).
  - No new tab key is added, so no tab whitelist changes. Confirm with `grep -rn "\"diff\"" client/src/app/repos` that `tab=diff` is already accepted.
- Acceptance criteria (`OverviewTab.test.tsx`; mock only the network-level hooks module, render the real `PrBriefCard`):
  - DOM order is VerdictBanner, then the PR Brief card title, then IntentCard, then the Description section. The Intent/Blast wrapper carries the two-column layout marker, and its stylesheet rule declares two columns at `min-width: 1024px` (AC-30).
  - Two reviews (older score 40, newer score 80): the banner shows 80. Blockers count only non-dismissed CRITICAL findings. No `kind:'review'` with a verdict: no banner (AC-38).
  - Page-level reachability: clicking the focus item `src/config.ts:12` calls the router with `/repos/<repoId>/pulls/<n>?tab=diff&file=src%2Fconfig.ts&line=12` (AC-37).
  - The brief query is not enabled while the PR detail is loading (no `headSha`) (AC-28).
- Done-condition: `scripts/check.sh client OverviewTab PrBriefCard DiffTab`

### Task T8: Seeded brief + hermetic e2e flow
- Agent: implementer
- Requirement-ID: AC-27, AC-30, AC-37, AC-42 (e2e parts per Q2 decision)
- Depends-on: [T4, T7]
- Owned paths: [`server/src/db/seed.ts`, `e2e/specs/13-pr-brief.flow.json`]
- Skills to apply: [`drizzle-orm-patterns` — digest (seed insert); e2e: none, follow `e2e/AGENTS.md`]
- Key constraints:
  - Seed: insert or upsert (idempotent, `onConflictDoUpdate` on `prId`) one `pr_brief` row for PR #482. Its JSON must pass `PrBrief.parse` (import the contract and parse before inserting):
    - `head_sha: 'a1b2c3d4e5f6'`, equal to the seeded PR head, so it is not stale and no POST is sent;
    - a distinctive summary, e.g. `"Seeded brief: rate limiting touches the public API config."`;
    - one risk with `file_refs: ['src/config.ts']`;
    - one focus item `src/config.ts:<line>`, where `<line>` lies inside a new-side hunk range of the seeded `src/config.ts` patch (read the seeded patch and pick a line);
    - `provider: 'openai'`, `model: 'seed'`, `tokens_in`/`tokens_out` `0`, `cost_usd: null`, `attempts: 1`, `data_gaps: []`, `inputs: []`, `dropped` zeros.
  - Only add the row. Don't change any other seeded data (other flows and `.it` tests depend on it).
  - Flow: copy the command forms of the passing `05-pr-diff.flow.json` (`open`, `wait --url`, `find text … click`, `wait --load networkidle`, `wait --text`, `find role button click --name`). No `chat`, no new command forms. Match only untransformed text (`client/INSIGHTS.md`).
  - Steps:
    1. Open PR #482; `wait --text` the seeded summary (AC-30: the card is on Overview).
    2. Reload with `open` on the same URL; `wait --text` the seeded summary again (AC-27: cached brief is shown).
    3. `find text "src/config.ts:<line>" click`; `wait --url tab=diff`; `wait --url file=src%2Fconfig.ts` (AC-37); `wait --text src/config.ts` (AC-42: file rendered).
  - The flow description states that the no-POST, in-viewport and highlight-duration checks live in the T5/T6 RTL tests (Q2 decision).
- Acceptance criteria:
  - `E2E_FLOWS=13 ./scripts/e2e.sh` exits 0 and every step of `13-pr-brief.flow.json` is executed.
  - `scripts/check.sh server --it test/brief.it.test.ts` is still green after the seed change: that suite seeds the DB, and its tests must not assume "no brief for PR #482", or they must create their own PR rows.
- Done-condition: `scripts/check.sh server --it test/brief.it.test.ts && E2E_FLOWS=13 ./scripts/e2e.sh`

## Final verification (run once by the orchestrator, not by any task)
- `diff server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts` (empty)
- `scripts/check.sh reviewer-core`
- `scripts/check.sh server`
- `scripts/check.sh server --it` (confirm the executed-test count; a skipped run is not green)
- `scripts/check.sh client`
- `scripts/arch-check.sh`
- `./scripts/e2e.sh` (hermetic stack, all flows, never the dev stack/DB)
- Manual (AC-24 second clause): in `next dev`, push a commit to a PR with a brief and open Overview. The server log shows exactly one `call:"pr_brief"` request/response pair.

## Out of scope / deferred
- Rejected recommendation 1: prompt assembly in the server `brief` module. It goes to reviewer-core per the intent precedent.
- PR history computation (`history` is always `[]`, NG3); streaming/SSE (NG7); retry loops (NG8); CI/MCP surfaces (NG9); diff viewer redesign (NG10).
- Deriving intent from the brief (NG1); redesigning `IntentCard`/`BlastRadiusCard` (NG4); a per-brief document picker (NG6).
- A lock that holds across multiple processes (accepted recommendation 3 is in-process only).
- Extending the shared `MockLLMProvider` (accepted recommendation 4 keeps the stub test-local).
- Syncing the other diverged `vendor/shared` files (only `brief.ts` is mirrored).

## Open questions
- None blocking. Decisions recorded as defaults (owner: implementer; flag in the Execution Report if wrong):
  - Validation uses the full blast snapshot (recommendation 6).
  - Budget gaps use `source:'budget'` (recommendation 7).
  - Linked issue = first `issue`-type link from `extractIntentLinks` (Q3).

## Red flags
- **Strict Mode + mutation from an effect (AC-24):** the module-scope `Set` must be filled *before* `mutate`. The cache write must be in the `useMutation` options, or the response is lost on the torn-down instance (`client/INSIGHTS.md` 2026-09-21). Mocked-hook unit tests can't reproduce this, so do the manual check in Final verification.
- **Lock race (AC-11):** check-and-set must happen synchronously, before any `await` in the POST handler, or two requests both pass the check.
- **No diff bodies (AC-17):** anything that serialises `pr_files.patch` into the prompt, logs or persisted `inputs` is a violation. Only numbers parsed from `@@` headers may leave the parser.
- **Failed generations must never upsert (AC-15):** scrub error messages with `scrubText`. Don't put the raw provider error in `details`.
- **`.it` suites skip silently on Windows** when the Docker probe times out (`server/INSIGHTS.md`). `check.sh --it` exits 3 on zero executed tests. Don't treat a skipped run as green, and don't run `.it` in parallel with the unit lane.
- **Contract change ripple:** `PrBrief` changes shape (`intent`/`blast` become nullable, new required fields). Nothing consumes it today, but `server/test/**` is not typechecked, so the T1 grep for consumers matters.
- **Seed change (T8)** affects every `.it` suite and every e2e flow that seeds. Keep it additive and idempotent.
- **Token budget:** `⌈chars/4⌉` is measured on the *final* message strings (after `wrapUntrusted` delimiters and headings), not on raw section content, or the 8,000 cap can be exceeded by the wrapping overhead.
- **Deep-link query params are untrusted:** match `file` exactly against PR paths before acting. Never put it into a selector string (use a data attribute or ref lookup, not `querySelector(\`[data-path="${file}"]\`)` with unescaped input).
