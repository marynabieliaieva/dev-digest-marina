# Tags feature notes

## Files created (all under server/)
- server/src/db/schema/tags.ts - Drizzle `tags` table (id, repo_id, name, color, created_at; unique per repo+name)
- server/src/modules/tags/types.ts - domain types + repository port
- server/src/modules/tags/constants.ts - name length / color pattern
- server/src/modules/tags/repository.ts - Drizzle implementation of the port
- server/src/modules/tags/service.ts - validation, duplicate check, not-found handling
- server/src/modules/tags/routes.ts - GET/POST /repos/:repoId/tags, DELETE /repos/:repoId/tags/:tagId
- server/src/modules/tags/index.ts - barrel
- server/src/platform/container.ts - MODIFIED copy: wires `tags: TagService`

## Still to do
- Generate the migration (`drizzle-kit generate`, then `db:migrate`); not hand-written.
- The scaffold has no schema index or app/server entry: export `tags` from the schema barrel (if any) and register `tagRoutes` with `{ container }` in the Fastify app. Map errors with `statusCode` (404/409/422) to HTTP in the error handler; ZodError should map to 400.
- Add `fastify`, `zod`, `drizzle-orm` deps if not present.
- Nothing outside server/ is required (no client changes). Tests not written.
- `repo_id` has no FK because the repos table is not in the scaffold; add a reference (with onDelete cascade) once it exists.
