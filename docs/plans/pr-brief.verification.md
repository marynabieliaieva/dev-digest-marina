# Plan Verification: docs/plans/pr-brief.md (tasks T1–T8)

Produced by the `plan-verifier` agent after all 8 implementer tasks were reported done
(single-agent run, branch `lesson_05`, changes uncommitted in the working tree at that time).
Spec: `specs/2026-10-10-pr-brief/spec.md` (SPEC-02). This file is the report as returned by the
agent, saved verbatim in substance; the section "After the verification" below was added by the
orchestrator.

## Summary

- **40 MET · 0 PARTIAL · 0 NOT MET · 2 CANNOT VERIFY**
- The 2 CANNOT VERIFY are T8's e2e items: the AC "`E2E_FLOWS=13` exits 0 and every step is executed", and the e2e half of T8's Done-condition.
- Skills claims in every task ("Skills to apply" / "Skills self-check") are claimed, not verifiable.

The change fingerprint of every task was recomputed and equals the implementer's value
(T1 `1fbee7de…`, T2 `b2f58b67…`, T3 `27a09626…`, T4 `8c657c96…`, T5 `f9a16345…`, T6 `10e98efd…`, T7 `c92cca31…`, T8 `83352562…`).
Each reported "Test/verification results" block has exit 0 and 0 skipped for `.it` runs, so those
blocks were accepted as the command results.

Commands the verifier re-ran itself:
- reviewer-core `test/brief-{prompt,generate,validate}.test.ts`: 14 passed, typecheck ok.
- client `src/lib/hooks/brief.test.ts PrBriefCard OverviewTab DiffTab FileCard SmartDiffGroup`: 46 passed, typecheck ok.
- server `--it test/brief.it.test.ts`: 15 passed (Docker up, so executed, not skipped), typecheck ok.

## Task T1: Extend the brief.ts contract (AC-1, AC-2, AC-3)

| # | Acceptance criterion | Status | Evidence |
|---|---|---|---|
| 1 | `PrBrief.parse(fixture)` succeeds with `intent: null`, `blast: null`, `summary`, `review_focus`; throws without `head_sha` (AC-2) | MET | `server/test/brief-contracts.test.ts` "parses a valid PrBrief", "rejects a PrBrief without head_sha" |
| 2 | `ReviewFocusItem` rejects `line: 0` and `line: 1.5` | MET | "rejects non-positive or fractional lines" |
| 3 | `PrBriefGeneration.safeParse({ summary:'s', risks:[] })` fails (no `review_focus`) (AC-3) | MET | "requires review_focus in PrBriefGeneration" |
| 4 | `PrBriefRequest.parse({})` gives `{ mode: 'refresh' }` | MET | "defaults request mode to refresh" |
| 5 | `diff server/.../brief.ts client/.../brief.ts` exits 0, no output (AC-1) | MET | verifier ran the diff: identical |

Done-condition: MET (fingerprint match, exit 0, 5 tests; diff and client/reviewer-core typecheck re-run).

## Task T2: reviewer-core brief engine (AC-13, 16, 17, 18, 20, 23, 23a)

| # | Acceptance criterion | Status | Evidence |
|---|---|---|---|
| 1 | Input section order matches AC-16 | MET | `brief-prompt.test.ts` "keeps the AC-16 section order" |
| 2 | Diff body lines (marker `MARKER_7f3a`, context lines) never reach the messages; range numbers do (AC-17) | MET | "sends ranges but never diff body lines" |
| 3 | ~30k tokens of specs and 6 gap notes → `estTokens ≤ 8000` (AC-18) | MET | "stays within the budget with huge specs and 6 gap notes, and keeps the gap note" |
| 4 | Gap note text present even when `specs` was cut | MET | same test |
| 5 | 120 files: 100 listed plus a count line for 20 | MET | "lists 100 files plus a count line for the rest" |
| 6 | Title cut at 300 chars, body at 4,000 | MET | "cuts title at 300 and body at 4000 chars" |
| 7 | Exactly 1 `completeStructured` call, `schemaName === 'PrBriefGeneration'`, `maxTokens === BRIEF_MAX_OUTPUT_TOKENS`, `attempts` passed through; errors propagate after 1 call (AC-13) | MET | "makes exactly one structured call and returns attempts", "propagates errors unchanged after one call" |
| 8 | AC-23 example with counts 1/1/1 | MET | `brief-validate.test.ts` "applies the AC-23 example" |
| 9 | 10 risks → 8, sorted high → medium → low, stable | MET | "sorts risks by severity (stable) and caps at 8" |
| 10 | 9 focus items → 6 | MET | "caps focus items at 6" |
| 11 | Blast-only file with a caller line is kept | MET | "keeps a blast-only file with a caller line" |
| 12 | Pure-deletion file (`+c,0`) focus item dropped (E9) | MET | "drops a focus item on a pure-deletion file" |
| 13 | All invalid → empty lists, summary kept (AC-23a) | MET | "returns the summary with empty lists when everything is invalid" |

Done-condition: MET (14 tests re-run, server typecheck ok).

## Task T3: Workspace-wide document collector (AC-19)

| # | Acceptance criterion | Status | Evidence |
|---|---|---|---|
| 1 | Enabled agents + enabled skill links merged in order, first occurrence wins (`['specs/a.md','specs/c.md']`) | MET | `project-context-workspace.it.test.ts` "merges enabled agents and enabled skill links, first occurrence wins", "ignores skills whose agent link is disabled" |
| 2 | Statuses `missing`, `too_large`, `unreadable`; no clone → `clone: false`, no throw | MET | "records statuses for missing, too large and unreadable documents", "returns clone:false without throwing when the repo has no clone" |
| 3 | Existing project-context integration tests stay green | MET | reported run: 24 passed, 0 skipped, fingerprint match |

Done-condition: MET.

## Task T4: Server `brief` module (AC-4 … AC-15, 17, 19 … 22, 45)

All checked in `server/test/brief.it.test.ts` (15 passed in the verifier's re-run).

| # | Acceptance criterion | Status | Evidence |
|---|---|---|---|
| 1 | GET with stored brief: no LLM, no GitHub calls (AC-4) | MET | `service.ts:40-43` DB only; "AC-4/5/8" test |
| 2 | Stale detection by `head_sha`; no brief → `brief: null, stale: false` (AC-5) | MET | `service.ts:72-80` |
| 3 | Held generation: GET `generating: true`; two concurrent POSTs → one 200, one 409 `brief_in_progress`, 1 LLM call (AC-6, AC-11) | MET | `service.ts:57-66` no `await` between `locks.has` and `locks.set`; test "AC-6/11" |
| 4 | Other workspace → 404; bad id → 422 (AC-7) | MET | test "AC-7" |
| 5 | POST `{}` and POST without payload → 200, new brief (AC-8) | MET | `routes.ts:37` `z.preprocess((v) => v ?? {}, PrBriefRequest)` |
| 6 | `if_stale`: fresh → 0 LLM calls; stale → 1 call and new `head_sha` (AC-9, AC-10) | MET | test "AC-9/10" |
| 7 | Rate limit: 11th POST → 429 on a non-test app; route `config.rateLimit` is `{ max: 10, timeWindow: '1 minute' }` | MET | test "AC-12" |
| 8 | One `completeStructured` per POST, schema `PrBriefGeneration`, stored `attempts` = stub's (AC-13) | MET | test lines 175-177 |
| 9 | Model from `feature_models.risk_brief`; no hard-coded model ids (AC-14) | MET | test lines 266-279; `grep -rnE "gpt-\|claude-\|o[0-9]-" server/src/modules/brief` empty |
| 10 | Failures: 401 → 502 `provider_error`; schema failure → `schema_invalid`; missing LLM key → `missing_key`; no GitHub token + working LLM → 200 with `linked_issue/missing` gap; failed brief never stored (AC-15) | MET | tests "AC-15 …", `helpers.ts:39-45`, `service.ts:202-208` |
| 11 | `toBriefFailure` mappings, message scrubbed | MET | 4 tests in `brief-helpers.test.ts` |
| 12 | No diff body in the request, hunk ranges present (AC-17) | MET | test "AC-17", line 331 |
| 13 | Specs in `inputs` with refs in order (AC-19) | MET | test "AC-19" |
| 14 | No intent / repo-intel off → gaps `{intent, missing}`, `{blast_radius, degraded}` (AC-20) | MET | test "AC-20" |
| 15 | Blast service throws → 200 with summary and `blast_radius/missing` gap (AC-21) | MET | `service.ts:125-130`; test "AC-21" |
| 16 | Ready intent snapshot stored (AC-22) | MET | test "AC-22" |
| 17 | Exactly one `tool` log before and one after the call; no PR body in logs (AC-45) | MET | `service.ts:185-197, 256-267`; test "AC-45" |
| 18 | Gap builder cases | MET | `brief-helpers.test.ts` lines 41-70 |

Done-condition: MET (`.it` suite re-run: 15 passed, 0 skipped).

## Task T5: Client hooks + PrBriefCard + i18n (AC-24 … 29, 31 … 37, 39 … 41)

| # | Acceptance criterion | Status | Evidence |
|---|---|---|---|
| 1 | Stale response → exactly one `POST { mode: 'if_stale' }`, also under StrictMode and re-render | MET | `hooks/brief.ts:20-24, 73-78` (module-scope `Set`, cache write in `useMutation` options); test "auto-regenerates … exactly once, even under StrictMode" |
| 2 | No retry after a rejected auto-regeneration (AC-24) | MET | test "does not retry after a rejected auto-regeneration" |
| 3 | 409 → poll every 2,000 ms until `generating: false` (AC-25) | MET | `hooks/brief.ts:42, 56-60`; test "polls after a 409…" |
| 4 | Fresh response → 0 POSTs (AC-27) | MET | test "does not POST when the brief is fresh" |
| 5 | Query disabled without `headSha`; changed `headSha` refetches (AC-28) | MET | `hooks/brief.ts:41`; test "stays disabled without a headSha…" |
| 6 | Card states: summary, sha, model, cost, gaps, risks, skeleton, Updating badge, empty focus (AC-26, 29, 31–36) | MET | `PrBriefCard.test.tsx` (8 tests) |
| 7 | Focus item navigates to `?tab=diff&file=src%2Fconfig.ts&line=12`; risk ref without `line` (AC-37) | MET | tests "renders a focus item and navigates with file and line", "navigates from a risk file ref without a line" |
| 8 | Blast-only file shows "File not in this PR's diff", no navigation (AC-39) | MET | test "does not navigate for a file outside the diff" |
| 9 | Error text, Retry, previous summary kept, Settings hint on `missing_key` (AC-40) | MET | tests "shows the server error with Retry…", "omits the settings hint for other failures" |
| 10 | No hard-coded copy; no `dangerouslySetInnerHTML` (AC-41) | MET | grep empty |

Done-condition: MET (19 tests; included in the verifier's 46-test client re-run).

## Task T6: Files-changed deep-link (AC-42, 43, 44)

| # | Acceptance criterion | Status | Evidence |
|---|---|---|---|
| 1 | `focusFile`: card expanded, `scrollIntoView` on header, highlight until 2,000 ms, in both orders (AC-42) | MET | `FileCard.tsx` (`DEEP_LINK_HIGHLIGHT_MS = 2000`); DiffTab tests "original order…", "smart order: same behaviour after switching order" |
| 2 | Smart order, collapsed role group: group opens, others stay collapsed | MET | `SmartDiffGroup.tsx`; test "smart order: opens a group that is collapsed by default…" |
| 3 | `focusLine` inside a hunk: scroll and highlight that row (AC-43) | MET | test "focusLine inside a hunk…" |
| 4 | Line outside hunks / file without patch: fall back to the file header | MET | test "falls back to the file header…" |
| 5 | Invalid `focusLine` (NaN, 0, negative, fractional) ignored | MET | `DiffTab.tsx` re-check; test "ignores a non-positive or NaN line" |
| 6 | `focusFile` not in diff: notice shown, diff still renders (AC-44) | MET | test "shows a notice and still renders the diff…" |
| 7 | Without focus props, existing tests unchanged | MET | included in the 46-test client re-run |

Done-condition: MET (23 + 22 tests).

## Task T7: Overview wiring (AC-28, 30, 37, 38)

| # | Acceptance criterion | Status | Evidence |
|---|---|---|---|
| 1 | DOM order: VerdictBanner, PR Brief card, IntentCard, Description (AC-30) | MET | `OverviewTab.test.tsx` "orders banner, brief, intent/blast, description…" |
| 2 | `matchMedia` true → `data-layout="two-col"`, false → `stacked`, `change` event switches | MET | `helpers.ts:32-33` `useMediaQuery`; test "switches the Intent/Blast layout with the media query" |
| 3 | Latest-verdict review; blockers count only non-dismissed CRITICAL; no review → no banner (AC-38) | MET | `helpers.ts:22-23`; test "shows the latest verdict…" |
| 4 | Click on `src/config.ts:12` → router call with `…?tab=diff&file=src%2Fconfig.ts&line=12` (AC-37) | MET (component level) | asserted at the `onNavigate` prop; `page.tsx` wires `router.push(href)` |
| 5 | Brief query not enabled while PR detail is loading (AC-28) | MET | test "does not request the brief until the head SHA is known" |

Done-condition: MET (37 tests).

## Task T8: Seeded brief + e2e flow (AC-27, 30, 37, 42)

| # | Acceptance criterion | Status | Evidence |
|---|---|---|---|
| 1 | `E2E_FLOWS=13 ./scripts/e2e.sh` exits 0 and every step of `13-pr-brief.flow.json` runs | **CANNOT VERIFY** | The implementer's run failed before any flow step (`agent-browser open` timed out at 60 s); unmodified flow 05 fails the same way. Needs a working hermetic stack with agent-browser |
| 2 | `scripts/check.sh server --it test/brief.it.test.ts` still green after the seed change | MET | re-run: 15 passed |

Done-condition: the `.it` half is MET; the e2e half is CANNOT VERIFY.

Static checks on the flow: command forms match flows 05/11; the seeded summary string equals `seed.ts:421`; the seeded focus item is `src/config.ts:12` (`seed.ts:423`). Risk noted by the implementer: the card renders the focus item as one text node `"src/config.ts:12 — Hardcoded secret key on this line."` (`PrBriefCard.tsx:192-205`); whether `find text "src/config.ts:12"` matches by substring depends on agent-browser semantics, which could not be checked.

## ACs without test evidence

- T8 AC-27/30/37/42 e2e parts: no executed evidence (e2e unverified); RTL tests cover AC-27, 30, 37 and 42 separately.
- T7 AC-37 "page-level": the test only reaches the `onNavigate` prop; the `page.tsx` `router.push` wiring and the `file`/`line` query parsing have no test.
- AC-12 429 test: present in the suite, depends on the non-test `nodeEnv` app built inside the test, not inspected beyond its name and assertions.

## Scope checks

- Missing: none for owned paths. `server/test/routes-smoke.test.ts` untouched (allowed by the plan).
- Extra:
  - `client/next-env.d.ts` was modified (`.next` → `.next-e2e` route-types reference), an artifact of the e2e attempt, not in any task's owned paths. **Reverted by the orchestrator afterwards.**
  - `docs/features/project-context/` is untracked and not part of this plan.
  - `client/src/lib/hooks/index.ts` modified: sanctioned by T5.
- Forbidden paths: none touched (no `server/src/db/migrations/**`, no lock files, no `docs/plans/**` changes in the working tree).
- Dependency order: no violations.

## Not verifiable here

- E2E flow 13 (T8): needs a hermetic stack where `agent-browser open` completes within its timeout.
- Manual AC-24 second clause (exactly one `pr_brief` generation pair in `next dev`): needs the live stack; Strict Mode is covered only by the hook unit test.
- All "Skills to apply" / "Skills self-check" claims.

## Out of remit

Architecture boundaries → `architecture-reviewer` (result: `ARCHITECTURE_CLEAN`); general code quality and merge gate → `pr-self-review` (result: PASS, 0 critical, 5 high, 17 medium; see below).

## After the verification (added by the orchestrator)

- Final full run: reviewer-core 76 tests, client 186 tests, server integration 144 tests all passed; server unit 297 passed and 6 failed in `indexer-pipeline.test.ts` (pre-existing, recorded in `server/INSIGHTS.md`); e2e flow 13 not run (environment timeout, same for flow 05).
- Open items (not "unclosed requirements" of the plan, but open findings from `pr-self-review`): unmapped 500 after the LLM call (`service.ts:235`), `file`/`line` params not cleared on tab switch (`page.tsx:66`), effect-copies-props-to-state and inline-prop issues in `SmartDiffGroup`/`FileCard`/`page.tsx`.
- The two CANNOT VERIFY rows (T8 e2e) remain unverified; they are an environment limitation, not a missing implementation.
