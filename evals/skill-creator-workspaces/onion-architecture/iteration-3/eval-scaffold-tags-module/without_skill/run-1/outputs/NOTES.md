# Tags module - notes

Files created (all under server/):
- server/src/db/schema/tags.ts - Drizzle table `tags` (id, repo_id, name, color, created_at; unique per repo+name)
- server/src/modules/tags/types.ts - Tag type, zod create schema (name, #RRGGBB color)
- server/src/modules/tags/repository.ts - TagRepository port + DrizzleTagRepository (only file touching Drizzle)
- server/src/modules/tags/service.ts - TagService (list/create/delete; 409 on duplicate, 404 on missing)
- server/src/modules/tags/routes.ts - GET/POST /repos/:repoId/tags, DELETE /repos/:repoId/tags/:tagId
- server/src/modules/tags/index.ts - registerTags(app, container) wiring

Endpoints: GET /repos/:repoId/tags, POST /repos/:repoId/tags {name,color}, DELETE /repos/:repoId/tags/:tagId.

Outside server/ / not done here (existing files, not edited):
- Re-export schema from the db schema barrel (if any) so drizzle-kit sees it, then run `pnpm db:generate` and `pnpm db:migrate` (migrations are generated, not hand-written, and don't run on boot).
- Add FK `repo_id -> repos.id` (on delete cascade) in tags.ts once the repos schema is available.
- Call `registerTags(app, container)` from the app bootstrap; ensure an error handler maps `statusCode` of platform errors to HTTP responses.
- Optional: move the zod contract into the shared package (server/src/vendor/shared) for client/mcp use; add a client UI and tests (unit with a fake TagRepository; `*.it.test.ts` for DB).
- Dependencies assumed present: fastify, zod, drizzle-orm, postgres.
