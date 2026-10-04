# Agents (`.claude/agents/`)

A map of the project's subagents. The full rules live in each agent's file
(frontmatter + prompt); this page is only navigation and a summary, without repeating their text.

## Pipeline

```
researcher (ad hoc, any time)

planner → docs/plans/<slug>.md → implementer   (one per task)
                               → test-writer   (one per task, tests only)
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
             plan-verifier                     architecture-reviewer
        (plan AC / Done-condition)          (layer and package boundaries)
                    └─────────────────┬─────────────────┘
                                      ▼
                     pr-self-review (skill) — the only merge gate
                                      ▼
                     doc-writer → docs/features/<slug>/
```

`pr-self-review` remains the **only merge gate**: none of the agents below issues
PASS/BLOCKED or writes its status file — they supply evidence or work after it.

## Summary table

| Agent | Responsibility | Model | Permissions (`tools`) | Input | Output |
|---|---|---|---|---|---|
| [`researcher`](researcher.md) | Answer one concrete question — about the repository or external sources | sonnet | Read, Grep, Glob, Bash, WebFetch, WebSearch | A question | Research report (Conclusions / Evidence / Sources / Could not determine) or clarifying questions |
| [`planner`](planner.md) | Turn a feature into a Development Plan: tasks, AC, dependency DAG, non-overlapping owned paths, skills | opus | Read, Grep, Glob, Bash, Agent(researcher), Write\* | A feature/change description | `docs/plans/<slug>.md` |
| [`implementer`](implementer.md) | Execute **one** plan task within its owned paths | sonnet | Read, Grep, Glob, Edit, Write, Bash, Skill | Plan + task id | Code in owned paths + Execution Report |
| [`test-writer`](test-writer.md) | Write/extend tests for existing code; never edit production code | sonnet | Read, Grep, Glob, Edit, Write\*, Bash, Skill | Plan + task id, or a named target | Tests from the allowlist + Test Report (incl. suspected production bugs) |
| [`architecture-reviewer`](architecture-reviewer.md) | Read-only check of architectural boundaries (onion, frontend modules, cross-package, "Do not touch") | opus | Read, Grep, Glob, Bash | A diff (default: branch vs `main`) or paths | Findings with `file:line` + quote + rule id, or `ARCHITECTURE_CLEAN` |
| [`plan-verifier`](plan-verifier.md) | Check the plan's AC and Done-condition point by point against the real code | opus | Read, Grep, Glob, Bash | Plan path (+ task ids, reports) | Plan Verification: MET / PARTIAL / NOT MET / CANNOT VERIFY |
| [`doc-writer`](doc-writer.md) | Document an already-implemented feature, checking claims against the code | sonnet | Read, Grep, Glob, Write\*, Edit\*, Bash, Skill | Plan / design note / PR / diff + slug | `docs/features/<slug>/README.md` (+ pages) + Doc Report |

\* — Write/Edit are restricted (see "How writing is restricted" below).

## How writing is restricted

| Agent | What it may write | Enforced by |
|---|---|---|
| `researcher`, `architecture-reviewer`, `plan-verifier` | Nothing | No Write/Edit in `tools` (the last two also have `disallowedTools`) |
| `planner` | Only `docs/plans/<slug>.md` | Hard Rule + hook [`planner-path-guard.mjs`](../hooks/planner-path-guard.mjs) |
| `test-writer` | Only test paths (allowlist) | Hook [`test-writer-path-guard.mjs`](../hooks/test-writer-path-guard.mjs) |
| `implementer` | Only the owned paths of its task | Prompt only (hard-forbidden: migrations, lock files, `docs/plans/**`) |
| `doc-writer` | Only `docs/features/<slug>/` | Prompt + self-check via `git status --porcelain` |

Hooks do not see `Bash` — there the restriction is by convention in the prompt only.
In an untrusted workspace, project-level hooks do not run.

## Who runs the checks (no repeats)

Tests/typecheck run **twice**, not three times: once by `implementer`, once by
the orchestrator at the end.

| Step | What it does with Done-condition commands |
|---|---|
| `implementer` | Runs them and pastes into the Execution Report: the command, exit code, last 15–20 lines of output, the `skipped` count for `.it` suites, and a change fingerprint (`git ls-files -mo --exclude-standard -- <owned paths> \| sort \| xargs sha1sum \| sha1sum`) |
| `plan-verifier` | **Checks the output instead of re-running**: accepts the block if exit is 0, `skipped` = 0, the fingerprint matches the one recomputed now, and the counts are plausible. Otherwise it re-runs the command itself. It always does the cheap checks (`grep`, `diff`, `git status`) itself |
| Orchestrator | One full run of everything at the end (server unit + `.it`, client, reviewer-core). Catches cross-task breakage that individual tasks cannot see |

The exception to the "reports are not evidence" rule: only a command result in a
complete, verifiable block; the verifier still does not accept a report's prose.
If a later task changed a shared file (e.g. `index.ts`), the fingerprint does not
match — the verifier re-runs.

## Preloaded skills (`skills:` in frontmatter)

`test-writer` → `react-testing-library`; `architecture-reviewer` →
`onion-architecture`, `frontend-ui-architecture`; `doc-writer` → `mermaid-diagram`.
The field only preloads the skill at startup and is **not** access control; the real
enforcement is the routing table from
`.claude/skills/pr-self-review/routing.md` + the self-check in the prompts.

## `planner` — what its rules are based on

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
