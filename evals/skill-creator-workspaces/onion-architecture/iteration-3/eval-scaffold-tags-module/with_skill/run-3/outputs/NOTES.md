# Tags feature - notes

## Files created (all under server/)
- server/src/db/schema/tags.ts - Drizzle table (unique repoId+name)
- server/src/vendor/shared/contracts/tags.ts - Zod `Tag`, `CreateTagInput`
- server/src/modules/tags/{routes,service,repository,helpers,constants}.ts

Layering: routes -> service -> repository -> db. Service takes the `Container`; only repository.ts imports drizzle; rows are mapped to the shared `Tag` type before leaving the repository. No new external integration, so no port/adapter/container change.

Endpoints: GET/POST `/repos/:repoId/tags`, DELETE `/repos/:repoId/tags/:tagId`.

## Must be done outside / beyond these files
- Re-export `./contracts/tags` from the shared package index (`server/src/vendor/shared` index, not in fixture).
- Copy the contract by hand to `client/src/vendor/shared/contracts/tags.ts` (outside server/).
- Export `tags` from the schema index and run `drizzle-kit generate` then `pnpm db:migrate` (migrations are not hand-written and not run on boot).
- Register `tagRoutes` (with `{ container }`) in the app bootstrap (not in fixture); ensure an error handler maps `statusCode` of the errors in platform/errors.ts and ZodError to 422/400.
- Add the FK `repoId -> repos.id` (repos schema not in fixture).
- Add tests (unit with a mocked repository; `*.it.test.ts` for DB).
