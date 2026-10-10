# File → Skill Routing

This is the bucket table [SKILL.md](SKILL.md) Step 2 uses to fan out. It only governs the
**additional, file-specific** skills — `security` and `code-review` already run on
everything per Step 1 and are not listed again here.

## Always excluded (never bucketed, never counted, never reviewed)

Per [AGENTS.md](../../../AGENTS.md)'s "Do not touch" list — these are generated or
immutable, flagging them as a "finding" would be noise the user can't act on anyway:

- `server/src/db/migrations/**` (incl. `meta/`)
- `server/pnpm-lock.yaml`, `client/pnpm-lock.yaml`
- `reviewer-core/package-lock.json`, `e2e/package-lock.json`

## UI files

| Skill | Patterns | Notes |
|---|---|---|
| `frontend-ui-architecture` | `client/src/**` | Where a component/hook/util belongs, colocation, feature-folder structure. |
| `react-best-practices` | `client/**/*.tsx`, `client/**/*.jsx` | Component/hook correctness, anti-patterns. |
| `next-best-practices` | `client/src/app/**`, `client/next.config.*` | App Router, RSC boundaries, async APIs. |
| `react-testing-library` | `client/**/*.test.tsx`, `client/**/*.test.ts` under `client/` | Test-file changes only. |

## Backend files

| Skill | Patterns | Notes |
|---|---|---|
| `onion-architecture` | `server/src/modules/**`, `reviewer-core/src/**` | Dependency direction, layer placement. |
| `fastify-best-practices` | `server/src/**/routes.ts`, `server/src/app.ts`, `server/src/platform/**` | Routes, plugins, hooks, validation. |
| `drizzle-orm-patterns` | `server/src/db/**` (excluding `migrations/**`, see above) | Schema/query authoring. |
| `postgresql-table-design` | `server/src/db/schema/**` | Schema-design review specifically. |

## Cross-cutting (bucketed by pattern, on top of the always-on Step 1 passes)

| Skill | Patterns | Notes |
|---|---|---|
| `zod` | `server/src/vendor/shared/**`, `**/*.schema.ts` | Contract/schema changes — also check for breaking changes to shapes other packages import. |
| `typescript-expert` | none by default | Only dispatch if a subagent/reviewer already flags non-trivial generic/type-level changes during Step 1 — don't run this on every PR. |

## Not part of review routing

`engineering-insights`, `mermaid-diagram` — meta/authoring skills, not review skills.
Never bucketed.

## Authoring agents (implementer / test-writer / implementation-planner)

This section is **not** used for review bucketing above — it is the single source
of truth for which skills the *writing* agents apply. The agents link here instead
of keeping their own copies of the table.

**Code (implementer).** Same globs as the review tables above, plus:

| Skill | Trigger | How the implementer applies it |
|---|---|---|
| `onion-architecture` | `server/src/modules/**`, `reviewer-core/src/**` | Read `RULES.md` digest; full skill only for a new module / new integration / container wiring |
| `frontend-ui-architecture` | `client/src/**` | Read `RULES.md` digest; full skill only for a new route/feature folder or moving components |
| `security` | task involves user input, API endpoints, secrets, auth, uploads (by topic, not path) | Read `RULES.md` digest; full skill for auth/secrets/uploads/shelling out |
| all other globbed skills (`fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`, `react-best-practices`, `next-best-practices`, `zod`) | as in the tables above | **Digest by default.** The plan's Key constraints carry the relevant rules. Invoke the full skill (once per session) only when the plan marks it `full`: a new schema table, a new shared contract, or a new route folder or module |
| `typescript-expert`, `mermaid-diagram` | on demand | Only when genuinely needed |
| `engineering-insights` | end of session, if something non-obvious was learned | Closing step, not per file |
| `pr-self-review` | — | Never invoked by an authoring agent — it is the gate that runs on them |

Digests live at `.claude/skills/<skill>/RULES.md`. A task's "Key constraints" in
the plan take precedence over re-reading a skill.

**Tests (test-writer).** Test files only need:

| Path | Skill |
|---|---|
| `client/**/*.test.ts(x)`, `client/src/test/**` | `react-testing-library` (full skill, once per session) |
| `server/test/**`, `reviewer-core/test/**` | none by glob — read the `RULES.md` digest of the skill governing the **file under test** only if needed to know which port to stub |
| `e2e/specs/**` | none — follow `e2e/CLAUDE.md` |

Production-code skills (`react-best-practices`, `frontend-ui-architecture`, …) are
**not** applied to test files.

## Unmatched files

If a changed file is under `client/` or `server/` but matches no pattern above, note it in
the report as "no specific skill matched — covered only by the Step 1 general passes"
rather than silently dropping it. Do not invent a skill assignment that isn't in this table.
