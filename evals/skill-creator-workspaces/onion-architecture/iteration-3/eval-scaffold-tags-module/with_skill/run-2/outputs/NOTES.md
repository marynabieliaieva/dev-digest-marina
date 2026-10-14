# Tags feature - notes

## Files created (all under server/)
- server/src/vendor/shared/contracts/tags.ts - Zod domain contract (Tag, CreateTagInput)
- server/src/db/schema/tags.ts - Drizzle table (unique repoId+name)
- server/src/modules/tags/{constants,repository,helpers,service,routes}.ts
  - routes: GET/POST /repos/:repoId/tags, DELETE /repos/:repoId/tags/:tagId
  - only repository.ts imports drizzle; service maps rows to the shared `Tag` via helpers.toTagDto; routes only call TagService

## Must be done outside / beyond these files
- Export `./contracts/tags.js` from server/src/vendor/shared index (not in scaffold) and add to schema barrel (db/schema/index.ts).
- Copy contracts/tags.ts by hand to client/src/vendor/shared (client/, outside server/).
- Generate migration with `drizzle-kit generate` then `pnpm db:migrate` (not run on boot; migrations not hand-written).
- Register `tagRoutes(app, container)` in the app bootstrap (not in scaffold).
- Add FK tags.repo_id -> repos.id (cascade) when merged with the real schema (repos table absent here).
- Client UI / hooks for tags (client/src/lib/hooks/tags.ts) if desired.
