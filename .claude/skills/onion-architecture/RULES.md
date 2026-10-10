# onion-architecture — authoring digest

Short rules for agents **writing** code (`implementer`). Reviewers use the full
skill ([SKILL.md](SKILL.md) + [enforcement.md](enforcement.md)). Invoke the full
skill instead of this digest when the task adds a **new external integration**,
scaffolds a **new module**, or wires something into `container.ts`.

Dependency rule: an import may only point inward (toward domain types and
business rules), never outward toward a framework/SDK/DB.

| File | May import | Must NOT import |
|---|---|---|
| `routes.ts` | its own `service.ts`, `@devdigest/shared` contracts, Fastify types | `drizzle-orm`, `postgres`, `db/client`, `db/schema/*`, any SDK |
| `service.ts` | ports (`GitHubClient`/`LLMProvider`/`GitClient`) via the `Container`, own `repository.ts`/`helpers.ts`, other modules' services | `octokit`, `openai`, `@anthropic-ai/sdk`, `simple-git`, `drizzle-orm`, `db/*` |
| `repository.ts` | `drizzle-orm`, `db/client`, `db/schema/*` | SDKs; must return shared/domain types, not `$inferSelect` |
| `@devdigest/shared/contracts/*` | `zod` only | anything from `server/` or `client/` |
| `reviewer-core/src/**` | `openai` SDK, `zod`, `@devdigest/shared` | DB, GitHub, filesystem |

Where new code goes:
1. New SDK/API → port in `@devdigest/shared/adapters.ts`, impl in
   `server/src/adapters/<name>/`, mock in `adapters/mocks.ts`, wire in
   `platform/container.ts`. Only that adapter imports the SDK.
2. Business rule / orchestration → `service.ts`; constructor takes the whole
   `Container`.
3. Shared shape → Zod schema in `@devdigest/shared/contracts/*.ts` (+ manual copy
   to `client/src/vendor/shared`).
4. Endpoint → `routes.ts`: parse → call **one** service method → map to status/body.
   No branching business logic, no queries.
5. Query → `repository.ts`; map Drizzle rows to domain types before returning.
6. Call into another module → `new OtherService(this.container)` at the call site.

Module files are role-named: `routes.ts`, `service.ts`, `repository.ts`,
`helpers.ts`, `constants.ts`. Never `new` an SDK client in a service or route.
