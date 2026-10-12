# Retro: project-context   |   2026-10-10   |   Workflow: spec-creator flow → implementation-planner → /run-plan → /pr-self-review

Inputs:
- spec: `specs/2026-10-10-project-context/spec.md` (SPEC-01)
- plan: `docs/plans/2026-10-10-project-context.md`, multi-agent mode
- `/run-plan` was run without flags; `/pr-self-review` was run separately

Data source: in-context, plus `--deep` (session `f486403a-31ed-413b-94f4-4df92b1d98ef`, window up to `2026-10-10T12:05Z`, which excludes the retro skill's own authoring).

Number sources: **[D]** = `--deep` parser, **[C]** = in-context agent reports, **[O]** = orchestrator's own observation in this run.

## 1. Run facts

**Wall time:** 10:18 → 12:03 UTC = 1 h 45 m [D].

| Phase | Time (UTC) |
|---|---|
| Spec | 10:18–10:29 |
| Plan | 10:29–10:39 |
| Execution (waves) | 10:43–10:59 |
| Verification + fixes | 10:59–11:06 |
| Final run + e2e debugging | 11:06–11:56 |
| pr-self-review | 11:59–12:03 |

**Agents:** 27, with at most 4 running in parallel [D].

| Type | Count |
|---|---|
| implementer | 20 (13 plan tasks + 7 fix tasks) |
| implementation-planner | 1 |
| plan-verifier | 1 |
| architecture-reviewer | 1 |
| general-purpose (pr-self-review passes, Opus) | 4 |

**Tokens [D]:** 54.2 M in total.
- Main session: 34.4 M. Subagents: 19.8 M.
- Fresh input + output: 2.15 M (main 0.36 M, subagents 1.80 M).
- Cache reads: 52.0 M (96 %).
- Output alone: 82.6 k in the main session and 31.2 k in subagents.

| Agent type | Tokens [D] |
|---|---|
| implementer | 9.64 M |
| PR review passes | 5.38 M |
| planner | 3.26 M |
| plan-verifier | 1.40 M |
| architecture-reviewer | 0.08 M |

**Top 3 agents by tokens [D]:**
1. implementation-planner: 3.26 M, 37 calls, 608 s. It has no AskUserQuestion in a subagent, so it had to return its questions and be resumed by the orchestrator.
2. PR correctness pass: 2.64 M, 24 calls (Opus).
3. T4b server module: 1.27 M, 15 calls. It was the largest implementer task, with 14 integration tests.

**Loops:**

| Loop | Rounds used / cap | Detail |
|---|---|---|
| Verification | 1 / 2 | 2 fix tasks |
| Architecture review | 0 / 3 | clean in round 1 |
| Final run | 2 / 2 | **cap hit**: e2e flow 12 still fails |
| pr-self-review | 1 | PASS, 0 critical, 4 high still open |

**Human interventions [O]:** 7 question rounds (AskUserQuestion calls and relayed questions) and 4 unprompted user inputs.

Question rounds:
- spec, blocking: 4 questions;
- spec, clarifications: 4 questions;
- planner questions relayed: 4 + 2;
- OQ-1;
- permission to migrate and seed the dev DB and run e2e;
- permission to stop the user's stale dev server.

Unprompted user inputs:
- footer copy "chunks → tokens total";
- "Inherited by N agents — not now";
- re-pasting requirements;
- "is something happening, or are you waiting for me?". The orchestrator had stalled because `/run-plan` must be typed by the user.

### Timeline [D]

| # | Phase / wave | Agent | Task | Outcome | Tokens (fresh / total) | Duration |
|---|---|---|---|---|---|---|
| 1 | Plan | implementation-planner | plan | written after 1 question round-trip | 155 k / 3.26 M | 608 s |
| 2–4 | Wave 1 ∥ | implementer | T1, T2, T3 | green | 68 k, 70 k, 57 k | 93 s, 173 s, 61 s |
| — | G1 | orchestrator | `db:generate` | clean, 2 tables | — | — |
| 5 | Wave 2, started early (deps met) | implementer | T6 seed | green (typecheck only) | 59 k | 55 s |
| 6–8 | Wave 2 ∥ | implementer | T4a, T7, T12 | green | 68 k, 61 k, 47 k | 199 s, 153 s, 145 s |
| 9–10 | Wave 3 ∥ | implementer | T8, T9 | T8 blocked by T9's in-progress typecheck, re-run green by orchestrator; T9 green | 63 k, 68 k | 213 s, 297 s |
| 11 | Wave 3 | implementer | T4b | green (14 integration tests) | 106 k | 246 s |
| 12 | Wave 4 | implementer | T5 | green (6 integration tests) | 70 k | 171 s |
| 13–14 | Wave 4 ∥ | implementer | T10, T11 | T11 blocked by T10's typecheck, re-run green | 52 k, 49 k | 172 s, 119 s |
| 15 | Wave 5 | implementer | T13 e2e | JSON-shape check only; flows not executed | 53 k | 100 s |
| 16 | Verify | plan-verifier | all tasks | 56 MET / 3 PARTIAL / 0 NOT MET / 2 CANNOT VERIFY | 107 k / 1.40 M | 157 s |
| 17–18 | Verify fixes ∥ | implementer | T4a parseGlobs, T8 test | green | 22 k, 21 k | 65 s, 62 s |
| 19 | Architecture review | architecture-reviewer | diff | ARCHITECTURE_CLEAN | 16 k | 41 s |
| 20 | Final-run fix 1 | implementer | T1 server tests | green | 19 k | 40 s |
| 21–22 | Final-run fix 1 | implementer | T13 click syntax, T10 VALID_TABS | green | 35 k, 33 k | 17 s, 67 s |
| 23 | Final-run fix 2 | implementer | T13 wait step | flow 12 still red | 28 k | 16 s |
| 24–27 | pr-self-review ∥ | general-purpose (Opus) | security, correctness, client, backend | 0 critical / 4 high / 17 medium | 104 k, 139 k, 119 k, 105 k | 70 s, 175 s, 98 s, 71 s |

**Serialisation [O]:**
- T4b waited for G1, which needed the orchestrator to run `db:generate`.
- T10 and T11 waited for T8.
- T13 ran last.
- About 50 minutes of the final run went to environment debugging:
  - a stale `:3000` dev server;
  - the dev DB holding extra repos;
  - the Docker probe skipping integration tests;
  - the bash PATH in `preview_start`.

## 2. Quality metrics

**First-pass yield:** 62 % (8/13) [C].

Tasks that later needed a fix task:
- T1: broke server tests.
- T4a: brace-glob split.
- T8: missing test.
- T10: Context tab unreachable.
- T13: flows not executable.

T8 and T11 also had a red first run, but that was caused by a sibling's in-progress files, not their own code.

**Rework ratio [D]:**
- Fresh tokens: 158 k ÷ 893 k = **17.7 %**.
- Total tokens including cache: 0.73 M ÷ 8.91 M = 8.2 %.

**Evidence reuse [C]:** plan-verifier accepted 14 of 14 tasks by fingerprint. It re-ran no tests. It did run 3 cheap extra checks: typecheck, grep and a JSON parse.

**Environment vs product [O]:**
- **8 environment issues:**
  - no Python on the machine: 3 implementer edit-script failures;
  - bash quoting failures in implementer pipelines: 3 of 4 agent tool errors;
  - the parallel `--it` Docker probe skipped 110 and then 97 tests, costing 2 wasted full runs of about 3 minutes;
  - the user's `next dev` (started 10:50) went stale after the contract changes, returning 500s and hangs;
  - the dev DB holds 3 extra real repos, so the non-hermetic e2e run landed on the wrong repo;
  - `preview_start` with Git-bash had no PATH;
  - the installed agent-browser rejects `click --text`, which already broke flow 08;
  - a cold compile takes over 60 s, so flow 01 times out.
- **These cost:** about 50 minutes of wall time, 2 extra full integration runs, 3 e2e runs, and roughly 40 main-session calls. They are not counted as agent mistakes.
- **Product defects:**
  - fixed: 5 (escape table #1–#4 and #6);
  - still open: 5 (flow 12 plus 4 HIGH findings from pr-self-review).

### Defect escape matrix

| # | Defect | Introduced in | Should have been caught by | Caught by | Why it slipped |
|---|---|---|---|---|---|
| 1 | `PROJECT_CONTEXT_GLOBS` split on commas inside `{…}` | T4a | T4a unit test | plan-verifier (out-of-remit note) | The config test covered only a plain list, not the default brace glob |
| 2 | `specs` type change broke `server/test/prompt-{callers,structured}.test.ts` | T1 | T1 Done-condition | final run (server unit suite) | The Done-condition covered reviewer-core only. Server `pnpm typecheck` does not cover `server/test/**`, so a consumer test breaks only at runtime |
| 3 | Agent Context tab unreachable: `agents/[id]/page.tsx` had its own `VALID_TABS` | T10 | T10 tests / plan owned paths | orchestrator, in the browser during e2e debugging | `page.tsx` was outside T10's owned paths. The RTL tests rendered `AgentEditor` directly. The planner didn't find the second tab whitelist |
| 4 | e2e flows used unsupported `click --text` | T13 | T13 Done-condition | final run (e2e) | The Done-condition was a JSON-shape check only. The syntax was copied from flow 08, which was itself already broken |
| 5 | Flow 12 still fails, cause unknown (**open**) | T13 | T13 | final run (e2e) | Flows were never executed inside the task. The cap was hit |
| 6 | Displayed token total delta untested (AC-17) | T8 | T8 tests | plan-verifier (PARTIAL) | The test asserted `onChange` only |
| 7 | Toggle is not optimistic, and two quick toggles drop one attachment (**open**) | T8 | plan-verifier (AC-17 "update immediately") | pr-self-review (code-review and react passes) | The fix-task test used a stateful wrapper that updates synchronously, which hid the server round-trip |
| 8 | Delete+insert replace races under concurrent PUTs (E12) (**open**) | T4b | T4b integration tests | pr-self-review (code-review) | No concurrency test was planned for E12 |
| 9 | Failed save leaves an unsaved draft order, with no error shown (**open**) | T8 / T10 / T11 | T8 tests | pr-self-review | No test covered the failure path |
| 10 | Skill Context tab: endless skeleton with no repo; attachments hidden when the repo isn't cloned (**open**) | T11 | T11 tests / plan-verifier (AC-40, E15) | pr-self-review | T11 didn't mirror T10's unavailable/no-repo handling. The verifier checked T11 only against its own AC bullets |

## 3. Insights per agent type

### implementer (20 runs)

**Hard**
- 3 of 4 agent tool errors are bash `unexpected EOF while looking for matching '` (T4a, T9, T13) [D].
- T1 and T2 lost cycles to "Python not found" and CRLF-aware replacement [C].
- Parallel client tasks share one typecheck. T8 was blocked by T9's half-written `DocTree/styles.ts`, and T11 by T10's wrong import depth [C].

**Easy**
- Narrow tasks with a precise plan section finished in 1–3.5 minutes with 0 fix cycles: T3 61 s, T6 55 s, T1 93 s [D].
- Server integration tasks were green first time: T4b 14/14, T5 6/6 [C].

**Duplicated**
- The plan file was read about 24 times, roughly once per implementer. That is expected, but each read is the full 600-line file [D].
- `RULES.md` digests were read about 11 times, and `run-executor.ts` and `config.ts` were re-read by later fix tasks [D].

**Missed**
- 5 reports admit the full skills were not invoked: T3, T4b, T9, T10, T11 [C]. Full-skill invocations across all implementers were only about 10 [D].
- T1 didn't run the server consumers' tests (#2).
- T10 couldn't touch the page file it needed (#3).

### implementation-planner (1 run)

**Hard:** it can't ask questions from a subagent, so it needed an orchestrator relay with 2 question batches. It was the most expensive agent: 3.26 M tokens, 608 s [D].

**Easy:** its grounding found 8 real repo facts the spec missed [C]:
- the seed has no clone;
- `Markdown` links lack `rel`;
- there is no sidebar item;
- the old hooks are dead;
- the two shared-contract copies differ only in comments;
- …and others.

**Missed:**
- the second tab whitelist in `agents/[id]/page.tsx` (#3);
- that the T1 Done-condition needed server consumer tests (#2);
- that the e2e flows needed an executing Done-condition (#4);
- E12 concurrency got no planned test (#8).

### plan-verifier (1 run)

**Easy:**
- It accepted all 14 tasks by fingerprint, with no test re-runs.
- It still found the brace-glob bug by reading code [C].

**Missed:**
- Static reading can't see runtime wiring (#3).
- It judged AC-17 "updates immediately" by test presence, not by behaviour (#7).

### architecture-reviewer (1 run)

**Easy:**
- It was the cheapest gate: 83 k total, 41 s [D].
- `arch-check.sh` did the work; both hits were correctly judged not to be findings [C].

**Duplicated:** pr-self-review re-ran the onion and frontend buckets anyway, because code changed after the review (#3 fix and others). Its report was therefore stale and not reusable.

### pr-self-review passes (4 runs, Opus)

**Easy:** they found 4 real HIGH defects (#7–#10) that every earlier gate missed.

**Duplicated:**
- 3 of the 4 HIGH findings were reported by two passes: code-review plus the react/client pass.
- The client pass re-reported decided item NG11.
- All 4 passes cost 5.38 M tokens [D].

**Missed:** they reported nothing about the still-failing flow 12. That is fine, because e2e is outside their remit.

### orchestrator (main session)

**Hard:**
- 154 API calls. 65 Bash calls and 25 browser calls, mostly environment debugging [D].
- It stalled once: `/run-plan` has `disable-model-invocation`, so it can only be started by the user, and the orchestrator hadn't said clearly that it was waiting [O].

**Easy:** starting T6 early (its deps were met) and re-running blocked tasks' checks itself avoided 2 fix tasks [O].

## 4. Module insights

- **server**
  - `pnpm typecheck` does not include `server/test/**`, so type changes in reviewer-core break server tests only at runtime.
  - `scripts/check.sh server --it` runs files in parallel, and the Docker probe then skips most suites while still exiting 0. A sequential run gives real numbers: `pnpm exec vitest run .it.test --no-file-parallelism` passed 125/125.
  - `db:migrate` prints "already exists, skipping" notices that look like errors.
- **client**
  - `agents/[id]/page.tsx` kept its own tab whitelist. It now derives from `AgentEditor/constants.ts`, the same way the skills page already did.
  - A long-running `next dev` goes stale after vendored-contract changes, with 500s and hangs. Restart it before e2e.
  - The `Checkbox` kit has no `disabled` prop.
  - `Markdown` headings render unstyled.
- **reviewer-core:** `specs` is now `ProjectContextDoc[]`. Anything that builds prompts in tests must pass `{source, content}`.
- **e2e**
  - The installed agent-browser rejects `click --text`, so pre-existing flow 08 is broken. Use `find text <x> click`.
  - The non-hermetic run against the dev DB lands on the wrong repo. Use `scripts/e2e.sh`.
  - Flows 11 and 12 mutate the DB and depend on running in order.
  - A cold compile exceeds the 60 s step timeout, which breaks flow 01.
- **tooling**
  - There is no Python on this machine.
  - `preview_start` with `bash.exe` has no PATH. `pnpm` as the runtime works.
  - An agent piping `check.sh … | tail` masks the exit code (T8).

**Suggested engineering-insights entries:**
- server: tests not typechecked; run `.it` sequentially.
- client: stale `next dev` after contract edits; page-level tab whitelist.
- e2e: `click --text` unsupported; hermetic runner only.
- tooling: no Python; `launch.json` should use `pnpm`, not bash.

## 5. Proposals

| # | Target (file) | Change | Evidence | Expected effect | Effort | Status |
|---|---|---|---|---|---|---|
| 1 | `.claude/agents/implementer.md` | Add a "Shell hygiene" rule: never call `python`; make multi-line edits with Edit/Write, not heredoc/sed scripts; never pipe `check.sh` through `tail`, and report its own exit code | 3/4 agent tool errors are quoting EOFs; T1/T2 Python failures; T8 exit masked | 0 shell-quoting tool errors and 0 masked exit codes next run | S | applied (uncommitted, 2026-10-10) |
| 2 | `.claude/agents/implementation-planner.md` | When a task changes a type or contract that another package consumes, its Done-condition must also run `scripts/check.sh <consumer> --related <changed file>` (e.g. reviewer-core → server tests) | Escape #2 | No final-run failure caused by a consumer package | S | applied (uncommitted, 2026-10-10) |
| 3 | `.claude/agents/implementation-planner.md` | For a new tab/route/nav entry, grep for every existing whitelist of that key set (`VALID_TABS`, tab arrays) and put those files in the owned paths; require one page-level test asserting the route renders it | Escape #3 | No "unreachable UI" defect after verification | S | applied (uncommitted, 2026-10-10) |
| 4 | `scripts/check.sh` | `--it`: run with `--no-file-parallelism`, and exit non-zero when executed tests = 0 or skipped = total | 2 wasted `--it` runs (110 and 97 skipped, exit 0) | `--it` gives real counts first time | S | applied (uncommitted, 2026-10-10) |
| 5 | `.claude/skills/run-plan/SKILL.md` + planner | e2e tasks get an executing Done-condition (`scripts/e2e.sh` filtered to the new flows); the final run's e2e uses `scripts/e2e.sh`, never the dev stack | Escapes #4/#5; stale `:3000`; dev DB with extra repos; cap hit | e2e defects found inside T13, final-run e2e loop ≤ 1 round | M | applied (uncommitted, 2026-10-10) |
| 6 | `.claude/agents/plan-verifier.md` | For ACs that state UX timing ("immediately", "optimistic"), require evidence in production code, and flag tests whose stateful wrappers bypass the real data flow | Escape #7: the fix test passed while the bug remained | No HIGH from pr-self-review on an AC the verifier marked MET | S | applied (uncommitted, 2026-10-10) |
| 7 | `.claude/skills/run-plan/SKILL.md` | Same-wave client tasks: tell implementers to judge typecheck errors only in their own owned paths (`tsc` output filtered) and report sibling errors as "blocked-by-sibling"; the orchestrator runs one wave-level typecheck | T8 and T11 blocked, then re-run by hand | 0 blocked-by-sibling Done-conditions | M | applied (uncommitted, 2026-10-10) |
| 8 | `.claude/skills/pr-self-review/SKILL.md` | Give the domain passes the code-review findings, or route `*.tsx` correctness only to code-review; run the domain passes on Sonnet; pass the decided Non-goals list | 3/4 HIGH reported twice; NG11 re-reported; 5.38 M tokens on 4 Opus passes | −30 % review tokens with the same HIGH recall | M | applied (uncommitted, 2026-10-10) |
| 9 | `.claude/agents/README.md` / spec→plan flow | Run implementation-planner in the main session (or let it return questions on its first turn without grounding twice) | Planner: 3.26 M tokens, 608 s, relay round-trip | −40 % planner tokens | M | applied (uncommitted, 2026-10-10) |
| 10 | `.claude/agents/implementer.md` + `pr-self-review/routing.md` | Decide the skill policy: either digest-only is officially enough (drop "invoke full skill once"), or full skills become mandatory and checked | 5 reports self-flag "skills gap"; about 10 full-skill invocations across 20 runs | No "skills gap" notes; a consistent policy | S | applied (uncommitted, 2026-10-10) |

## 6. Trend

First entry. No earlier retro for this workflow.
