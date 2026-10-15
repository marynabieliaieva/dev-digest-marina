# Architecture review: inventory PR (onion-architecture)

Scope: the 12 files in CHANGED.txt, checked against the Dependency Rule (imports point inward only), the layer table (routes -> service -> repository; ports via Container; contracts import nothing outward) and the review checklist. I also read the unchanged `reports/format.ts`, `platform/container.ts` and `platform/errors.ts` for context. I found 9 problems. Items 1-6 should be fixed before opening the PR.

## Blocking

### 1. `server/src/lib/mailer.ts` - SDK instantiated at module level, no port, not in the container
`new Resend(process.env.RESEND_KEY ?? '')` creates a concrete third-party client as an import-time singleton in `lib/`. It is a new external integration with none of the four required parts: no port in `shared/adapters.ts`, no adapter under `server/src/adapters/`, no mock in `adapters/mocks.ts`, no registration in `platform/container.ts`. It reads `process.env` directly. It cannot be replaced through `ContainerOverrides`, so any test of `SupplierService` would send real mail.
Fix: add an `EmailSender` (or `Notifier`) port to `@devdigest/shared/adapters.ts`. Move the Resend code to `server/src/adapters/email/` (the only file that imports `resend`, with the key coming from config or secrets). Add a mock to `adapters/mocks.ts`. Expose it as `container.email` and delete `lib/mailer.ts`.

### 2. `server/src/modules/suppliers/service.ts` - application layer imports the SDK through a wrapper
`import { mailer } from '../../lib/mailer.js'` followed by `mailer.emails.send(...)` is the same violation as importing `resend` directly. A grep for the package name would miss it, because the wrapper re-exports the forbidden dependency. The service also hard-codes the sender address and the message body.
Fix: use `this.container.email.send({ to, subject, text })`. Keep the policy (who to notify, what the text says) in the service and keep the transport in the adapter.

### 3. `server/src/modules/inventory/serializers.ts` - drizzle-orm, `db/client` and `db/schema/suppliers` imported outside a repository
This file imports `drizzle-orm`, the global `db` from `db/client.js` and the suppliers schema, and runs a query. Persistence is only allowed in `repository.ts`. It also uses the global `db` singleton instead of `container.db`, so it bypasses DI and cannot be tested against a mock or test DB. It reads another module's tables (`suppliers`), which crosses a module boundary at the database level.
Fix: delete the DB access from `serializers.ts`. Have `InventoryService.list()` return the full `InventoryItem[]`, enriching supplier names through `SupplierService` (or a batch `getNames(ids)` method on it). If a join is preferred, put it in a repository. Keep any pure mapping in `helpers.ts`.

### 4. `server/src/modules/inventory/routes.ts` - route reaches past the service and calls more than one thing
`withSupplierNames(await service.list())` calls a DB-backed helper directly from the route, so the route reaches into the persistence layer (see #3) and does orchestration (list, then enrich). A route should parse, call exactly one service method and map the result. The service's `list()` also returns the un-enriched `PlainItem[]`, so the API response shape is assembled in the transport layer.
Fix: `app.get('/inventory', async () => service.list())`, with the enrichment moved into the service. The `restock` route is fine.

### 5. `server/src/modules/suppliers/types.ts` and `service.ts` / `repository.ts` - raw Drizzle row type leaks out of the repository and through the service
`SupplierRow = typeof t.suppliers.$inferSelect` is exported from a module-level `types.ts`. `SupplierRepository.get` returns it, and `SupplierService.get(): Promise<SupplierRow>` exposes it in a public service signature. `reports/service.ts` then consumes it. The allowed place for a `$inferSelect` type is the repository/service seam only, and it must be mapped to a shared domain type before leaving the service (compare `RepoRepository` / `toRepoDto`). `types.ts` also imports `db/schema` from a non-repository file.
Fix: add a `Supplier` Zod contract to `@devdigest/shared/contracts/` (copy it to the client vendor folder by hand). Keep the row type private to `repository.ts` and map it there (`toSupplier`). Return `Supplier` from the repository and service, then delete `types.ts`. Compare `InventoryRepository`, which does this correctly with `toItem` / `PlainItem`.

### 6. `server/src/vendor/shared/contracts/inventory.ts` - domain layer imports from an outer layer
The contract imports `LOW_STOCK_THRESHOLD` from `../../../modules/inventory/constants.js`. Domain/contracts may import only `zod`. This makes the innermost layer depend on a server module, and the contract is copied to `client/src/vendor/shared`, where that relative import will not resolve. The `isLowStock` helper also puts business logic in a schema file.
Fix: remove the import. Either move the threshold into shared (a `constants` file in `@devdigest/shared`) and have `modules/inventory/constants.ts` re-export it, or drop `isLowStock` from the contract and keep the rule in the inventory service (where `lowStock()` already applies it) or pass the threshold as an argument.

## Should fix

### 7. Circular dependency: `inventory/service.ts` <-> `suppliers/service.ts`
`InventoryService.requestRestock` constructs `SupplierService`, and `SupplierService.openItemCount` constructs `InventoryService`. Each file statically imports the other. Instantiating at the call site is the sanctioned way to call another module, but it must be one-directional. A cycle couples the two modules, makes initialisation order fragile, and tells you the responsibilities are split wrongly.
Fix: pick one direction (inventory depends on suppliers, which fits `requestRestock` and the supplier name enrichment). Move `openItemCount` out of `SupplierService`, for example to the caller or a reporting service that composes both, or compute it from `InventoryService.listBySupplier` where it is needed. Optionally add a cruiser rule forbidding module cycles.

### 8. `server/src/modules/reports/service.ts` - reaches into another module's repository
`new InventoryRepository(this.container.db).list()` imports `inventory/repository.js` directly, skipping `InventoryService`. This bypasses the inventory module's business rules and couples reports to inventory's persistence and its `PlainItem` shape. The rule is service -> other modules' services. The loop also calls `suppliers.get(...)` once per item (N+1), and `get` throws `NotFoundError`, so one dangling `supplierId` breaks the whole report.
Fix: use `new InventoryService(this.container).list()`. After #3, that returns items with `supplierName` already attached, so the per-item supplier lookup can go. Otherwise batch the lookup. Make sure it does not recreate the cycle from #7.

## Minor / advisory

### 9. Repositories are built directly from `container.db` with no interface
`InventoryService` and `SupplierService` do `new XRepository(container.db)`. This matches the existing known gap for persistence, so it is not a blocker. `InventoryRepository` is already doing non-trivial work (list, get, listBySupplier, setQuantity), so consider an `IInventoryRepository` interface so the restock rules can be unit-tested without a DB. Related nit: `inventory/service.ts` ends with a pointless `export type { InventoryItem }` re-export. Import the type from `@devdigest/shared` where it is needed.

## Looks fine
- `inventory/repository.ts` returns a mapped `PlainItem` rather than a Drizzle type, and only the repository imports Drizzle in that module.
- `inventory/constants.ts` and `reports/format.ts` are pure with no imports.
- Restock validation and "not found" handling live in the service, not the route.
- `platform/errors.ts` has no outward dependencies.
- `reports/routes.ts` is thin and calls a single service method.

## Suggested fix order
1 and 2 (email port and adapter), 3 and 4 (move supplier enrichment into the service), 5 (Supplier contract), 6 (contract import), then 7 and 8 (module cycle and reports dependency).
