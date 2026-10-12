# Architecture review: inventory PR (onion-architecture)

Scope: the 12 files in CHANGED.txt, plus unchanged files read for context (`reports/format.ts`, `platform/container.ts`, `platform/errors.ts`). The snapshot is server-only.

Verdict: **do not open yet.** There are 9 findings, 7 of them blocking.

Dependency rule used: imports point inward only. Domain is `shared/contracts`. Application is `service.ts` and depends on ports and the repository. Infrastructure is `repository.ts` and `adapters/*`. Transport is `routes.ts` and calls exactly one service.

## Blocking

### 1. `server/src/vendor/shared/contracts/inventory.ts` - domain imports from an outer layer
- Line 2: `import { LOW_STOCK_THRESHOLD } from '../../../modules/inventory/constants.js'`.
- Why: the domain layer (shared contracts) now depends on a server module. Contracts may import `zod` only, and must never depend on `server/` or `client/` code. It also breaks the client copy, because `client/src/vendor/shared` has no `modules/inventory` to import from.
- Fix: put `LOW_STOCK_THRESHOLD` in the contract file or a shared constants file inside `shared`, and have `modules/inventory/constants.ts` and `service.ts` import it from `@devdigest/shared`. Then manually copy the contract to `client/src/vendor/shared`.

### 2. `server/src/lib/mailer.ts` + `server/src/modules/suppliers/service.ts` - SDK used directly, no port
- `mailer.ts` runs `new Resend(process.env.RESEND_KEY)` at module scope. `suppliers/service.ts` line 3 imports it and calls `mailer.emails.send(...)` on line 23.
- Why: this is the "new external integration" violation, reached through a local wrapper that re-exports the SDK client. A grep for `resend` in `service.ts` would miss it. The service cannot be tested without hitting Resend, because `ContainerOverrides` cannot swap it. The client is built from `process.env` instead of `SecretsProvider`, and `lib/` is not a layer in this architecture.
- Fix, all four parts:
  1. Add a `MailClient { send(to, subject, text): Promise<void> }` port in `shared/adapters.ts`.
  2. Add `server/src/adapters/mail/resend.ts`, the only file that imports `resend`. Read the key through secrets.
  3. Add `MockMailClient` to `adapters/mocks.ts`.
  4. Add an async `container.mail()` getter with an override.
  Then `SupplierService` calls `(await this.container.mail()).send(...)`. Delete `lib/mailer.ts`.
- Also move the hard-coded `from: 'ops@example.com'` into config or constants.

### 3. `server/src/modules/inventory/serializers.ts` - persistence code outside a repository
- Imports `drizzle-orm`, `db/client.js` and `db/schema/suppliers.js` (lines 1-3) and queries the DB.
- Why:
  - Only `repository.ts` may import `drizzle-orm`, `db/client` or `db/schema/*`. The file name hides a data-access path.
  - It uses the global `db` singleton rather than `container.db`, so it cannot be overridden in tests.
  - It reads the `suppliers` table from the inventory module, which crosses a module boundary at the schema level.
- Fix: delete the file. Do the enrichment in `InventoryRepository` (a join on suppliers) or, to respect module ownership, have `InventoryService` ask `SupplierService` for names. Return `InventoryItem[]` from the service.

### 4. `server/src/modules/inventory/routes.ts` - route reaches past the service
- Line 11: `withSupplierNames(await service.list())` calls the serializer, which does DB I/O, directly from the handler. That makes it two steps (service plus a DB-touching helper) instead of one service call.
- Why: enrichment is orchestration and belongs in the application layer. As written, `service.list()` returns the un-enriched `PlainItem[]`, so the service's contract is not the real API response. The behaviour can only be tested through Fastify.
- Fix: `app.get('/inventory', async () => service.list())`, where `service.list()` returns `Promise<InventoryItem[]>` (see #3).

### 5. `server/src/modules/suppliers/types.ts` + `service.ts` + `repository.ts` - Drizzle row leaks through the service
- `types.ts` imports `db/schema/suppliers.js` and exports `SupplierRow = typeof t.suppliers.$inferSelect`. `SupplierRepository.get` and `SupplierService.get` return it.
- Why: a public `service.ts` signature exposes `$inferSelect`, so the DB column shape reaches `reports/service.ts` and any future consumer. `types.ts` is also a schema import outside `repository.ts`. The raw row type should be local to the repository.
- Fix:
  1. Add a `Supplier` Zod schema and type in `shared/contracts/suppliers.ts`.
  2. Keep the row type private in `repository.ts`.
  3. Map row to `Supplier` in the repository or a `helpers.ts` `toSupplier()`, and return `Supplier` from the service.
  4. Delete `types.ts`.

### 6. `inventory/service.ts` <-> `suppliers/service.ts` - circular module dependency
- `InventoryService.requestRestock` constructs `SupplierService` (line 41). `SupplierService.openItemCount` constructs `InventoryService` (line 32).
- Why: each service imports the other, so the two modules cannot be understood or loaded independently. It also makes accidental infinite construction possible, because each constructor builds a repository from the container.
- Fix: make the dependency one-directional. Inventory may depend on suppliers (it needs notify and names). Remove `SupplierService.openItemCount` and `import { InventoryService }`, and move that count to the caller, or to a query on `InventoryService` that `reports` composes. If suppliers truly needs inventory data, put a shared read in a third place, but avoid a two-way import.

### 7. `server/src/modules/reports/service.ts` - imports another module's repository
- Line 2: `import { InventoryRepository } from '../inventory/repository.js'`, and line 10 builds it with `container.db`.
- Why: cross-module calls must go through the other module's service. This bypasses inventory's business rules and mapping, and couples reports to inventory's persistence.
- Fix: use `new InventoryService(this.container).list()`, with the type from `@devdigest/shared`.

## Non-blocking / should fix

### 8. `reports/service.ts` - N+1 supplier lookups
- Line 15 awaits `suppliers.get()` inside a loop, one query per item.
- Fix: if the inventory list already carries `supplierName` (after #3), use that. Otherwise add a batch `SupplierService.getMany(ids)` that uses `inArray` in its repository. This also stops reports depending on the supplier row shape.

### 9. Duplicated business rule and minor cleanup
- Duplicated rule: `inventory/service.ts` `lowStock()` (line 35) repeats `quantity < LOW_STOCK_THRESHOLD`, while the contract exports `isLowStock`. Use `isLowStock` so the rule exists once.
- Redundant export: `export type { InventoryItem }` at the end of `inventory/service.ts` re-exports a shared type and should be removed.
- Validation split: the `amount` bounds check (1..MAX_RESTOCK_QUANTITY) is in the service, while the route only checks `int()`. That is acceptable, because the business rule stays in the service. Keep it there, and make sure the route maps `ValidationError` (422) consistently.
- Repository interfaces: both repositories are instantiated directly with no interface. This is the known persistence gap. It is acceptable here, but consider interfaces if their logic grows, and mention it in the PR.

## Looks fine
- `reports/routes.ts`: transport only, one service call.
- `reports/format.ts`: a pure helper with no imports.
- `inventory/repository.ts`: Drizzle only, maps rows to `PlainItem` before returning.
- `inventory/constants.ts`: literals only.
- Services take the whole `Container`, as expected.
