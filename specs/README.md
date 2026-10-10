# specs/

The single home for **every feature specification** — whether the feature
touches one module or several.

- Each spec lives at `specs/<YYYY-MM-DD>-<feature-name>/spec.md`
  (creation date + feature name, e.g. `2026-10-10-pr-risk-score`). The touched
  modules/packages are listed in the spec header's `Modules:` line.
- A spec is the input of the `implementation-planner` agent, which writes the
  plan into `docs/plans/<slug>.md`, and only once the spec is `Status: approved`.
  Specs describe behaviour, workflows, service communication and contracts —
  normally not implementation details.
- Nothing but specs belongs in this folder — no plans, code, or general docs
  (plans go to `docs/plans/`, feature documentation to
  `docs/features/<same-slug>/`, written by `doc-writer`).
- Specs are written in English by the [`spec-creator`](../.claude/agents/spec-creator.md)
  agent and follow its template (EARS acceptance criteria, `SPEC-NN` ids).
- The end-to-end flow (spec → plan → execution → review → docs) is described in
  [`.claude/agents/README.md`](../.claude/agents/README.md) and driven by the
  [`/run-plan`](../.claude/skills/run-plan/SKILL.md) skill.
