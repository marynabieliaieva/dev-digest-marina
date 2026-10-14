# Onion Architecture — Enforcement

What to flag in review, how to turn the core anti-pattern into a CI-checkable
rule, and the checklist to run over any PR touching
`server/src/modules/<name>/`. Read [SKILL.md](SKILL.md) and
[layer-map.md](layer-map.md) first for the layers and dependency direction
this section enforces.

## Anti-Patterns to Flag

- **A route handler importing `drizzle-orm`, `postgres`, or a Fastify
  decorator's raw db client directly**, skipping `service.ts`/`repository.ts`
  entirely. Even a "quick" read-only endpoint should go through the service.
- **`service.ts` importing `octokit`, `openai`, `@anthropic-ai/sdk`, or
  `simple-git` directly** instead of receiving the port
  (`GitHubClient`/`LLMProvider`/`GitClient`) through the container. This is
  the single most common onion violation and the one this skill exists to
  catch — grep for these package names inside any `service.ts`. This also
  covers **local wrapper modules that re-export a forbidden dependency**,
  not just the npm package name itself: `import { db } from
  '.../db/client.js'` or `import { ... } from '.../db/schema/...'` is the
  same violation as importing `drizzle-orm` directly — a literal grep for
  `drizzle-orm` won't catch it, so also check for any import reaching into
  `db/client.js` or `db/schema/*` from outside `repository.ts`.
- **A `$inferSelect`/`$inferInsert` Drizzle type appearing in a `service.ts`
  method signature (parameter or return type)** rather than being mapped to a
  shared/domain type inside `repository.ts` or `helpers.ts` first.
- **Business logic (branching, validation, orchestration) written directly
  in `routes.ts`** instead of `service.ts`, because "it's just one line."
  It's still the wrong layer, and it means the logic can't be unit-tested
  without spinning up Fastify's inject().
- **A `@devdigest/shared/contracts/*.ts` file importing anything from
  `server/` or `client/`** — the domain layer must never depend on an outer
  layer, even transitively.
- **A new external SDK wired up with a `new` call directly inside `service.ts`
  or a route handler**, instead of going through `container.ts`. If it can't
  be swapped for a mock via `ContainerOverrides`, it isn't inverted.

- **A hand-built error response in `routes.ts`**
  (`reply.code(404).send({ error: 'not_found' })`, a `try/catch` that only maps
  an error to a status, or a bare `throw new Error(...)` /
  an ad-hoc `{ statusCode }` error). Failures are `AppError` subclasses from
  `platform/errors.ts`, rendered by the one `setErrorHandler` in `app.ts`; a
  hand-built body skips the `{ error: { code, message, details } }` envelope
  the client depends on.
- **An adapter letting a vendor exception escape** (an `AxiosError`, an
  `S3ServiceException`, an Octokit `RequestError`) instead of wrapping it in
  `ExternalServiceError` — it leaks the SDK type into the application layer
  and bypasses the 502 mapping.

See [examples.md](examples.md) for a before/after of each of these.

## Searching for Indirect Violations

A `grep` for `drizzle-orm` or `octokit` in `service.ts` only finds the direct
case. Most real leaks are one or two files away, so walk the module graph
instead of grepping one file at a time:

1. **Inventory.** List every file of each changed module (and of any module the
   change calls) and write down what each one imports.
2. **Follow local imports one hop.** For every `service.ts` and `routes.ts`, open
   each local file it imports (`helpers.ts`, `serializers.ts`, `types.ts`,
   `lib/*`) and read *their* imports. A service that imports a helper that
   imports `drizzle-orm`, `db/client.js`, `db/schema/*` or an SDK has the same
   leak, one file removed. Report the whole chain
   (`service.ts → helpers.ts → db/client.js`), not only the last link.
3. **Treat wrappers as the SDK.** A local module that exports a configured SDK
   client or db handle (`lib/payments.ts` doing `export const stripe = new
   Stripe(...)`, `lib/mailer.ts`) is the vendor itself. Importing it from a
   service is the same violation as importing the package, and it cannot be
   swapped through `ContainerOverrides`.
4. **Follow type aliases.** `export type XRow = typeof t.x.$inferSelect` in a
   `types.ts` is a Drizzle type under a friendlier name. If a service or route
   signature uses it, that is the `$inferSelect` leak.
5. **Check cross-module reach.** A `service.ts` or `routes.ts` importing another
   module's `repository.ts` or `db/schema/<other>` skips that module's
   business rules. The call must go through its `service.ts`
   (`new OtherService(this.container)`).
6. **Check for cycles.** If module A's service imports module B's service and B's
   imports A's, flag the cycle. Fix it by moving the shared piece into the
   module that is lower in the dependency order, or by having only one side
   call the other.
7. **Check the domain layer's imports too.** `@devdigest/shared/contracts/*`
   importing anything from `modules/`, `adapters/` or `platform/` is the
   inward layer depending outward, however innocent the helper looks.

Do not report as violations: a service taking the whole `Container`, a service
building its own `new XRepository(container.db)`, a one-way
`new OtherService(this.container)` call, or `drizzle-orm` inside a
`repository.ts`. Those are the intended shape.

## Optional Enforcement: `dependency-cruiser`

`dependency-cruiser` is already a `server/package.json` dependency, but today
it's only used as a library inside
[server/src/adapters/depgraph](../../../server/src/adapters/depgraph) to
analyze the import graph of *other* repositories for the `repo-intel`
indexer — it is not currently configured to check dev-digest's own codebase.
Adding a `.dependency-cruiser.js` at the `server/` root with a forbidden-rule
like the one below turns this skill's core anti-pattern into a CI-checkable
rule instead of something only caught in review:

```js
// server/.dependency-cruiser.js — sketch, not yet wired into CI
module.exports = {
  forbidden: [
    {
      name: 'service-must-not-import-sdks-directly',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/service\\.ts$' },
      to: { path: '^(drizzle-orm|postgres|octokit|openai|@anthropic-ai/sdk)$' },
    },
    {
      name: 'routes-must-not-import-db-or-sdks',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/routes\\.ts$' },
      to: { path: '^(drizzle-orm|postgres|octokit|openai|@anthropic-ai/sdk)$' },
    },
    {
      name: 'shared-contracts-must-not-import-server-or-client',
      severity: 'error',
      from: { path: '^src/vendor/shared/contracts/' },
      to: { path: '^src/(modules|adapters|platform)/' },
    },
  ],
};
```

Treat this as a starting point to refine, not a drop-in file — run it once
against the current `server/` tree and expect it to need tuning before it's
strict enough to turn on in CI.

## Quick Checklist (for reviews)

1. Does any `service.ts` import a concrete SDK (`drizzle-orm`, `octokit`,
   `openai`, `@anthropic-ai/sdk`, `simple-git`) instead of a port from
   `shared/adapters.ts`?
2. Does any `routes.ts` reach past `service.ts` into a repository, adapter,
   or raw db client?
3. Does a `service.ts` method's signature expose a `$inferSelect`/
   `$inferInsert` Drizzle type instead of a shared/domain type?
4. Is there branching business logic sitting in `routes.ts` that belongs in
   `service.ts`?
5. Does a new external integration have a port in `shared/adapters.ts`, a
   concrete implementation in `server/src/adapters/<name>/`, a mock in
   `adapters/mocks.ts`, and a registration in `container.ts` — all four, not
   just the concrete implementation?
6. Does anything under `@devdigest/shared/contracts/` or `reviewer-core/`
   import from `server/` or `client/`? That's the domain layer depending
   outward — never acceptable.
7. If a repository is growing complex query/business logic, has an interface
   been considered so it can be swapped for a mock in tests, the same way
   GitHub/LLM/git already are?
8. Does any `routes.ts` write a 4xx/5xx reply body by hand, remap an error in a
   `try/catch`, or throw a bare `Error`, instead of throwing an `AppError`
   subclass from `platform/errors.ts`? Does any adapter let an SDK exception
   escape instead of wrapping it in `ExternalServiceError`?
9. Following local imports one hop (`helpers.ts`, `serializers.ts`, `types.ts`,
   `lib/*`), does any `service.ts` or `routes.ts` reach `drizzle-orm`,
   `db/*` or an SDK transitively? Does any service use a type alias of a
   Drizzle `$inferSelect`/`$inferInsert` in a signature?
10. Does any `service.ts` or `routes.ts` import another module's
    `repository.ts` or `db/schema/*`, or form an import cycle with another
    module's service?
