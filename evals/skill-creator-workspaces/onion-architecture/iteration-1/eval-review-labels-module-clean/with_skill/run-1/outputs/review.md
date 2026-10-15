# Architecture review: labels module

Scope: `server/src/modules/labels/` (constants.ts, repository.ts, service.ts, routes.ts), reviewed against the onion-architecture skill checklist.

## Verdict

No architecture problems found. The module is fine to open as a PR from a layering point of view.

## Checklist results

1. service.ts imports a concrete SDK or db/client or db/schema? No. It imports only shared types, `Container`, platform errors, its own repository and constants. (`import type { Db }` is only in repository.ts.)
2. routes.ts reaches past the service? No. It parses the body with Zod, calls one `LabelService` method per endpoint and maps the result to a status code.
3. Drizzle `$inferSelect`/`$inferInsert` type exposed past the repository? No. `LabelRow` is private to repository.ts and is mapped by `toLabel` to the shared `Label` type before returning. Service signatures use only `Label`.
4. Business logic in routes.ts? No. Name trimming, length validation and the per-repo limit are in service.ts.
5. New external integration? None added, so no port/adapter/mock/container work is needed.
6. Domain layer importing outward? Not touched by this module.
7. Repository interface: see non-blocking note below.

## Non-blocking notes (not violations)

- **Persistence is not behind a port** (`new LabelRepository(container.db)` in service.ts). This matches the existing repos/reviews/agents pattern and the skill treats it as an accepted gap. The repository logic is small, so no interface is needed now.
- **Not architecture, FYI:** `repository.ts` `countByRepo` loads every row via `listByRepo` just to take `.length`. A `count()` query would be cheaper. Optional.
