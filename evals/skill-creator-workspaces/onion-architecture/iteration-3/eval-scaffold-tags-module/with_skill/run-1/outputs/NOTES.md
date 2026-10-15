# Tags feature - notes

## Files created (all under server/)
- server/src/vendor/shared/contracts/tags.ts - Zod contracts: Tag, CreateTagInput, params
- server/src/db/schema/tags.ts - Drizzle `tags` table (unique on repo_id + name)
- server/src/modules/tags/constants.ts, repository.ts, helpers.ts, service.ts, routes.ts

Layering: routes -> service -> repository -> db. Only repository.ts imports drizzle; service maps rows to the shared `Tag` DTO. No external integration, so no new port/mock. Endpoints: GET/POST `/repos/:repoId/tags`, DELETE `/repos/:repoId/tags/:tagId`.

## To do outside the new files / outside server/
- Existing files in server/ not in the fixture (edit by hand): export `./tags.js` from `server/src/db/schema/index.ts`; export `./contracts/tags.js` from the shared contracts index; register `tagRoutes(app, container)` in the app/route bootstrap.
- Run `pnpm db:generate` to create the migration (do not hand-write one), then `pnpm db:migrate` (migrations don't run on boot). Add the `repos.id` FK (see TODO in the schema) before generating.
- Outside server/: manually copy contracts/tags.ts to `client/src/vendor/shared/` (shared contracts are duplicated by hand); optionally add client hooks (`client/src/lib/hooks/tags.ts`) and UI; add tests (`*.it.test.ts` for DB-backed).
