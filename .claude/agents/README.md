# Agents (`.claude/agents/`)

A map of the project's subagents. The full rules live in each agent's file
(frontmatter + prompt); this page is only navigation and a summary, without repeating their text.

## Pipeline

Three manual stages; only the last one is automated.

```
researcher (ad hoc, any time)

1. manual   spec-creator → specs/<slug>/spec.md        (optional sdd:clarify) → user: Status: approved
2. manual   implementation-planner → docs/plans/<slug>.md   (refuses a non-approved spec)
3. /run-plan docs/plans/<slug>.md [--spec] [--designs …] [--review] [--docs] [extra requirements]
     0 preflight: waves from the DAG, skip test-writer tasks, classify extra requirements
     1 implementer ∥ … per wave                       (targeted scripts/check.sh, ≤3 fix cycles each)
     2 plan-verifier (all tasks) ⟲ fix tasks          (≤2 rounds)
     3 architecture-reviewer ⟲ fix ⟲ re-review         (≤3 rounds; re-review = previous findings + fixed files only)
       3b plan-verifier, scoped to tasks the fixes touched
     4 full suites once (plan's "Final verification") ⟲ fix
     5 [--review] pr-self-review (bug + security review, merge gate)
     6 [--docs]   doc-writer → docs/features/<slug>/
```

- `implementation-planner` started as a subagent cannot ask questions itself.
  When that happens it does one bounded grounding pass and returns all of its
  questions in one batch. Resume it with `SendMessage`, not a new `Agent`
  call, so it keeps its context. Pass already-made decisions in the first
  prompt so it doesn't re-ask them.
- `test-writer` is **paused** to save tokens: the planner adds test tasks only on
  request, and `/run-plan` skips any it finds. It still works ad hoc.
- Bugs are found by `pr-self-review` (`code-review` + `security`), **not** by
  `architecture-reviewer`, which checks layer/package boundaries only. Without
  `--review`, no bug review has run — run `/pr-self-review` before the PR.
- `plan-verifier` runs before the architecture review so missing ACs are fixed
  first, and accepts the implementer's test output by fingerprint instead of
  re-running it.

`pr-self-review` remains the **only merge gate**: none of the agents below issues
PASS/BLOCKED or writes its status file — they supply evidence or work after it.

## Summary table

| Agent | Responsibility | Model | Permissions (`tools`) | Input | Output |
|---|---|---|---|---|---|
| [`researcher`](researcher.md) | Answer one concrete question — about the repository or external sources | sonnet | Read, Grep, Glob, Bash, WebFetch, WebSearch | A question | Research report (Conclusions / Evidence / Sources / Could not determine) or clarifying questions |
| [`spec-creator`](spec-creator.md) | Turn a feature (and designs) into a spec: asks about gaps, edge cases, module interaction, UX; EARS acceptance criteria | opus | Read, Grep, Glob, Write\*, Edit\*, AskUserQuestion, Agent(researcher) | Feature description + user-supplied design sources | `specs/<slug>/spec.md` |
| [`implementation-planner`](implementation-planner.md) | Turn a spec/requirements into an Implementation Plan: reviews requirements, asks about gaps, recommends improvements, asks multi- vs single-agent mode; tasks, AC, dependency DAG, owned paths, skills. Never writes specs | opus | Read, Grep, Glob, Bash, Agent(researcher), Write\*, AskUserQuestion | An approved spec (or confirmed requirements) | `docs/plans/<slug>.md` (implementer tasks; test-writer tasks only on request; key constraints, targeted Done-conditions, test strategy) |
| [`implementer`](implementer.md) | Execute **one** plan task (or one fix task) within its owned paths; targeted `scripts/check.sh`, max 3 fix cycles | sonnet | Read, Grep, Glob, Edit, Write, Bash, Skill | Plan + task id | Code in owned paths + Execution Report |
| [`test-writer`](test-writer.md) | Write/extend tests for existing code; never edit production code | sonnet | Read, Grep, Glob, Edit, Write\*, Bash, Skill | Plan + task id, or a named target | Tests from the allowlist + Test Report (incl. suspected production bugs) |
| [`architecture-reviewer`](architecture-reviewer.md) | Read-only check of architectural boundaries (onion, frontend modules, cross-package, "Do not touch"), starting from `scripts/arch-check.sh`; diff / audit / re-review modes | sonnet | Read, Grep, Glob, Bash | A diff (default: branch vs `main`) or paths | Findings with `file:line` + quote + rule id, or `ARCHITECTURE_CLEAN` |
| [`plan-verifier`](plan-verifier.md) | Check the plan's AC and Done-condition point by point against the real code (after the waves + scoped after fixes) | sonnet | Read, Grep, Glob, Bash | Plan path (+ task ids, reports) | Plan Verification: MET / PARTIAL / NOT MET / CANNOT VERIFY |
| [`doc-writer`](doc-writer.md) | Document an already-implemented feature, checking claims against the code | sonnet | Read, Grep, Glob, Write\*, Edit\*, Bash, Skill | Plan / design note / PR / diff + slug | `docs/features/<slug>/README.md` (+ pages) + Doc Report |

\* — Write/Edit are restricted (see "How writing is restricted" below).

## How writing is restricted

| Agent | What it may write | Enforced by |
|---|---|---|
| `researcher`, `architecture-reviewer`, `plan-verifier` | Nothing | No Write/Edit in `tools` (the last two also have `disallowedTools`) |
| `spec-creator` | Only its one spec: `specs/<slug>/spec.md` | Hard Rule + hook [`spec-creator-path-guard.mjs`](../hooks/spec-creator-path-guard.mjs) |
| `implementation-planner` | Only `docs/plans/<slug>.md` (specs are unwritable) | Hard Rule + hook [`implementation-planner-path-guard.mjs`](../hooks/implementation-planner-path-guard.mjs) |
| `test-writer` | Only test paths (allowlist) | Hook [`test-writer-path-guard.mjs`](../hooks/test-writer-path-guard.mjs) |
| `implementer` | Only the owned paths of its task | Prompt only (hard-forbidden: migrations, lock files, `docs/plans/**`) |
| `doc-writer` | Only `docs/features/<slug>/` | Prompt + self-check via `git status --porcelain` |

Hooks do not see `Bash` — there the restriction is by convention in the prompt only.
In an untrusted workspace, project-level hooks do not run.

## Who runs the checks (no repeats)

All test runs go through [`scripts/check.sh`](../../scripts/check.sh): typecheck
first, then vitest with the `dot` reporter; the full log goes to
`.claude/tmp/check-<pkg>.log`, stdout gets only the summary or the first errors.

| Step | What it runs |
|---|---|
| `implementer` / `test-writer` | Only the task's **targeted** Done-condition (`check.sh <pkg> <files>` or `--related <sources>`), once after all edits; implementer max 3 fix cycles; errors in files it doesn't own are reported, not chased. Pastes the summary, exit code, skipped count and a change fingerprint |
| `plan-verifier` | **Checks the output instead of re-running**: accepts the block if exit is 0, `skipped` = 0, the fingerprint matches the one recomputed now, and the counts are plausible. Otherwise re-runs that (targeted) command. Always does the cheap checks (`grep`, `diff`, `git status`) itself |
| `architecture-reviewer` | No tests — [`scripts/arch-check.sh`](../../scripts/arch-check.sh) greps the mechanical rules, the agent judges the hits |
| Orchestrator (`/run-plan`) | The plan's `Final verification`: every touched suite in full, **once** (incl. `--it` when Docker is up). Catches cross-task breakage |

Nobody else runs a whole suite. If a later task changed a shared file (e.g.
`index.ts`), the fingerprint does not match and the verifier re-runs.

## Skills (single source of truth)

[`.claude/skills/pr-self-review/routing.md`](../skills/pr-self-review/routing.md),
section "Authoring agents", says which skills the writing agents apply; the
agents link to it instead of keeping their own copies. `onion-architecture`,
`frontend-ui-architecture` and `security` have short `RULES.md` digests that
`implementer` reads instead of the full skill (the full skill is for reviewers and
for the cases routing.md names). Other skills are invoked once per session, not
once per file. `test-writer` applies only `react-testing-library` (client tests)
— no production-code skills. Only `doc-writer` preloads a skill via `skills:`
(`mermaid-diagram`); the field is not access control.

## `implementation-planner` — what its rules are based on

- Claude Code docs, *Create custom subagents* — `tools:` as a least-privilege
  allowlist, `description:` as a trigger condition, `Agent(name)` scoping, a heavier model for planning.
- Anthropic, *When to use multi-agent systems (and when not to)* — a planning/execution split
  loses context on handoff unless the artifact carries it itself; hence the `Context` section in the plan format.
- Claude Code docs, *Orchestrate teams of Claude Code sessions* — sequential handoffs
  fit ordinary subagents, not agent teams.
- Repository: `.claude/skills/pr-self-review/routing.md` (the authoritative file→skill map,
  reused), root `AGENTS.md` (structure, "Do not touch", per-package `CLAUDE.md`/`INSIGHTS.md`),
  `researcher.md` (reference for frontmatter/body shape).
- User notes (not re-verified): Explore→Plan→Implement→Commit phases;
  opus/sonnet tiering; the plan as the single writable artifact; measurable AC + DAG; non-overlapping owned paths.

## `implementer` — what its rules are based on

- Claude Code docs, *Create custom subagents* — least-privilege `tools:`, `description:` as a trigger.
- Repository: `pr-self-review/routing.md` (skills table, reproduced verbatim);
  `security/SKILL.md` and `onion-architecture/SKILL.md` (dual-purpose — applied while
  writing code, while the verdict stays with `pr-self-review`); `AGENTS.md` ("Do not touch").
- `lst97/claude-code-sub-agents`, `architect-review.md` (a community example, not an official
  source) — a review agent only flags violations and does not decide; hence the `implementer` report
  has "left for review", not a verdict.
- User notes (not re-verified): a mandatory self-check instead of an optional skill call that
  "can silently be skipped"; owned/forbidden path discipline;
  an exact Done-condition command for self-verification; fresh context for review, separate from `implementer`.

## `spec-creator` — what its rules are based on

- Claude Code docs, *Create custom subagents* — least-privilege `tools:`, `description:` as a trigger,
  `hooks:` in frontmatter to enforce the write scope.
- EARS (Mavin et al., Rolls-Royce, 2009) — the acceptance-criteria syntax.
- Repository: `specs/README.md` (cross-module specs home), `implementation-planner.md` (the
  consumer of the spec — hence "what, not how"), `implementation-planner-path-guard.mjs` (the
  model for `spec-creator-path-guard.mjs`).
- User notes (not re-verified): ask about gaps instead of guessing; `[NEEDS CLARIFICATION]`
  markers instead of silent assumptions; traceability story → AC → edge case/NFR.
