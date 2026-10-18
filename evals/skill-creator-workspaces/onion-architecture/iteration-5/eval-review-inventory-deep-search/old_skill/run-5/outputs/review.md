# Architecture review: inventory PR (onion-architecture)

Scope: the 12 files in CHANGED.txt, plus `reports/format.ts`, `platform/container.ts`, `platform/errors.ts` read for context. Rule applied: imports may only point inward; `routes.ts` -> `service.ts` -> `repository.ts`/ports; SDKs only inside adapters behind a port wired in `container.ts`.

Verdict: do not open the PR yet. 9 problems (6 blocking).

## Blocking

### 1. `server/src/modules/inventory/serializers.ts` - Drizzle and global `db` in a non-repository file
- Why: imports `drizzle-orm`, `db/client.js` and `db/schema/suppliers.js`. Only `repository.ts` may touch these. It also uses the global `db` singleton instead of the container's `Db`, so it cannot be mocked or overridden, and it queries the `suppliers` table from the inventory module (cross-module data access).
- Fix: delete the file. Move the supplier-name enrichment into `InventoryService` (e.g. `listWithSupplierNames()`), which gets names via `SupplierService`/`SupplierRepository` (a batch `getMany(ids)` there). Return the shared `InventoryItem` type.

### 2. `server/src/modules/inventory/routes.ts` - route reaches past the service
- Why: `GET /inventory` calls `service.list()` and then `withSupplierNames(...)` itself. Orchestration and data access (via the serializer) happen in the transport layer, so the route calls more than one thing and indirectly runs DB queries. This is the "routes skip service" anti-pattern.
- Fix: route calls exactly one service method (`service.listWithSupplierNames()`) and returns the result. Routes should only parse, call, map to status/body.

### 3. `server/src/modules/suppliers/service.ts` + `server/src/lib/mailer.ts` - SDK used directly, no port
- Why: `service.ts` imports `mailer` from `lib/mailer.ts`, which does `new Resend(process.env.RESEND_KEY)` at module load. This is a new external integration (email) with no port in `shared/adapters.ts`, no adapter under `server/src/adapters/`, no mock in `adapters/mocks.ts`, and no registration in `container.ts`. It is a local wrapper that re-exports a forbidden SDK, so a grep for `resend` in the service would miss it. It cannot be swapped in tests via `ContainerOverrides`, and the env read bypasses config. `lib/` is also an unlayered location.
- Fix: add a `Mailer` (or `Notifier`) port to `@devdigest/shared/adapters.ts` (`send({to, subject, text})`), implement it in `server/src/adapters/mail/resend.ts` (the only file importing `resend`), add a mock to `adapters/mocks.ts`, register it in `platform/container.ts` (with an override), and in the service call `this.container.mailer.send(...)`. Delete `lib/mailer.ts`. Move the hardcoded `from: 'ops@example.com'` to config/constants.

### 4. `server/src/vendor/shared/contracts/inventory.ts` - domain layer depends outward
- Why: a shared contract imports `../../../modules/inventory/constants.js`. Domain/contracts must not import from `server/` modules (and the file is duplicated to `client/`, where that path will not exist, so it breaks the client copy). It also puts business logic (`isLowStock`) in a contracts file, which should be Zod schemas and inferred types only.
- Fix: contracts file keeps only the `InventoryItem` schema/type. Keep `LOW_STOCK_THRESHOLD` in `modules/inventory/constants.ts` and put the low-stock rule in the service/`helpers.ts`. If the client needs the threshold, put the constant in shared, not the reverse.

### 5. Circular dependency between `inventory/service.ts` and `suppliers/service.ts`
- Why: `InventoryService.requestRestock` constructs `SupplierService`; `SupplierService.openItemCount` constructs `InventoryService`. Two modules depend on each other (import cycle), which is fragile at module init and shows the module boundary is wrong.
- Fix: make the dependency one-directional. Suppliers should not know about inventory: remove `openItemCount` from `SupplierService` (let the caller compute it from `listBySupplier`), or move it to the inventory side. Keep only `inventory -> suppliers`.

### 6. `server/src/modules/reports/service.ts` - uses another module's repository directly
- Why: `new InventoryRepository(this.container.db)` skips `InventoryService`, bypassing its business rules and coupling reports to inventory's persistence internals. The rule is to call another module's service, not its repository.
- Fix: use `new InventoryService(this.container).list()` (or a dedicated service method that returns items with supplier names). The same call also removes the N+1 below.

## Should fix

### 7. `server/src/modules/suppliers/types.ts` and `suppliers/service.ts` - `$inferSelect` leaks out of the repository
- Why: `SupplierRow = typeof t.suppliers.$inferSelect` lives in `types.ts` (which imports the Drizzle schema), is returned by `SupplierRepository.get`, and `SupplierService.get()` returns it publicly, so `reports/service.ts` and others depend on the DB row shape. Service signatures must expose shared/domain types. (Compare `inventory/repository.ts`, which correctly maps to `PlainItem` in `toItem`.)
- Fix: define a `Supplier` Zod schema/type in `@devdigest/shared/contracts/suppliers.ts`, map the row inside `suppliers/repository.ts`, and have the service return `Supplier`. Keep the `$inferSelect` alias private to the repository; remove or reduce `types.ts`.

### 8. `server/src/modules/inventory/service.ts` - duplicated low-stock rule and weak domain typing
- Why: `lowStock()` re-implements `quantity < LOW_STOCK_THRESHOLD`, which also exists as `isLowStock` in the contracts file: two copies of one business rule. The service returns `PlainItem` (a repository-defined type, `Omit<InventoryItem,'supplierName'>`) from public methods rather than a shared domain type, and re-exports `InventoryItem` for no clear reason. `lowStock()` has no caller or route in the PR.
- Fix: one definition of the rule, in the inventory module (service or `helpers.ts`). Define the plain item shape in shared/contracts (or have the service return `InventoryItem` after enrichment). Drop the unused re-export; drop `lowStock` if unused.

### 9. `server/src/modules/reports/service.ts` - N+1 supplier lookup in a loop
- Why: `suppliers.get()` is awaited per item. Not strictly a layering violation, but a repository access pattern problem caused by composing per-row service calls.
- Fix: batch-load suppliers (`SupplierService.getMany(ids)`) once and map; ideally the same method used to fix #1.

## Notes (no action required)
- Repositories (`InventoryRepository`, `SupplierRepository`) are instantiated directly with `new` in the services; there is no interface. This is the known, accepted gap; consider an interface if the inventory repository grows.
- Cross-module calls using `new OtherService(this.container)` are the repo convention and fine once the cycle (#5) is removed.
- `RestockBody` is defined locally in routes; acceptable, but move it to a shared contract if the client needs it.
- `reports/routes.ts`, `reports/format.ts`, `inventory/constants.ts`, `platform/errors.ts` are clean.

## Suggested CI guard
Add dependency-cruiser rules: services/routes must not import `drizzle-orm`, `db/client`, `db/schema/*` or SDKs (`resend` included); `vendor/shared/contracts/**` must not import `src/modules|adapters|platform`; and forbid module-to-module cycles. Items 1, 3, 4 and 5 above would all be caught.
