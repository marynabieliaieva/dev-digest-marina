# Tags feature - notes

## Files created (all under server/)
- src/db/schema/tags.ts - Drizzle table (id, repo_id, name, color, created_at; unique per repo+name)
- src/modules/tags/types.ts - domain types
- src/modules/tags/ports.ts - TagRepository interface
- src/modules/tags/repository.ts - Drizzle implementation
- src/modules/tags/service.ts - business rules (duplicate name -> 409, missing -> 404)
- src/modules/tags/schemas.ts - zod request validation
- src/modules/tags/routes.ts - GET/POST /repos/:repoId/tags, DELETE /repos/:repoId/tags/:tagId

## To do outside the new files
- Generate the migration: `drizzle-kit generate` then run migrate (not done here).
- Export the schema from the schema index / drizzle config if one exists (not in scaffold).
- Register the plugin in the app bootstrap: `await tagRoutes(app, container)`.
- `repo_id` has no FK because the repos table is not in the scaffold; add `.references(() => repos.id, { onDelete: 'cascade' })` once it exists.
- Needs `zod` and `fastify` dependencies in server/package.json.
- Nothing is required outside server/ (no client, shared-contract, or docs changes).
