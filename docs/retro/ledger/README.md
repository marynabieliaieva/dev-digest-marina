# Workflow retro ledger

One file per retrospective of a multi-agent workflow run (`/run-plan`,
`/pr-self-review`, spec → plan → execution, …), written by the
[`/workflow-retro`](../../../.claude/skills/workflow-retro/SKILL.md) skill.

- The skill runs **only** when invoked by hand as `/workflow-retro [label] [--deep]`.
  Nothing runs it automatically.
- Each entry records:
  - run facts: agents, order, tokens, loops, interventions;
  - quality metrics: first-pass yield, rework, defect escapes;
  - insights per agent type and per module;
  - ranked proposals, whose `Status` is updated by later retros.
- Entries are append-only. A later retro adds a new file and compares against
  earlier ones in its "Trend" section; it never rewrites an old entry.

## Entries

- [2026-10-10 project-context](2026-10-10-project-context.md) — spec → plan → /run-plan → /pr-self-review, 27 agents, 54.2 M tokens (2.15 M fresh), FPY 62%
