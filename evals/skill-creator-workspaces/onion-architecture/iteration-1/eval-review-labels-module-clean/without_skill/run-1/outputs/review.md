# Review: labels module (server/src/modules/labels/)

## Verdict

No architecture problems found. The module is clean and can go to PR as far as layering is concerned.

## What I checked

- `routes.ts` (transport): only imports Fastify, zod and `LabelService`. Parses the body, calls the service, maps to HTTP status codes. No DB or SDK access, no business rules.
- `service.ts` (application): holds the business rules (name trimming/length, per-repo limit) using constants from `constants.ts`. It talks to data only through `LabelRepository`. No `drizzle-orm`, `octokit`, `openai` or `@anthropic-ai/sdk` imports. Errors come from the platform error classes.
- `repository.ts` (infrastructure): the only file importing `drizzle-orm` and the DB schema. It maps rows to the shared `Label` contract, so row types do not leak upward.
- `constants.ts`: plain values, no dependencies.
- Dependencies point inward only: routes -> service -> repository -> db. No cycles, no upward imports. File names follow the role-based convention.

## Non-architectural notes (optional, not blockers)

- `repository.ts` `countByRepo` loads every row just to take `.length`; a `count(*)` query would be cheaper.
- The limit check in `service.ts` `create` is check-then-insert, so concurrent requests could exceed `MAX_LABELS_PER_REPO` slightly. Likely acceptable.
- `routes.ts` `CreateLabelBody` has no length or format limits (the service validates name length; `color` is unvalidated).

Limitation: reviewed only these four files, treating the fixture as the repo root; `container.ts`, the schema and the error classes were not present, so their contents were not verified.
