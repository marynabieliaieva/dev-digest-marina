# Architecture review: inventory PR

Method: inventoried all files of the changed modules (inventory, suppliers, reports) plus `lib/`, `platform/` and the shared contract, followed every local import from each `service.ts`/`routes.ts` one hop, and checked wrappers, type aliases, cross-module reach and cycles.

Verdict: **7 problems, 5 of them blocking.**

## Blocking

### 1. Domain contract imports from a module (inward layer depends outward)
- File: `server/src/vendor/shared/contracts/inventory.ts:2`
- Problem: `@devdigest/shared/contracts` imports `LOW_STOCK_THRESHOLD` from `modules/inventory/constants.js`. The domain layer may only import `zod`. It also breaks the shared package for client/mcp/reviewer-core, which cannot reach `server/src/modules`.
- Fix: move `LOW_STOCK_THRESHOLD` into the contract (or a shared constants file inside shared) and have `modules/inventory/constants.ts` import it from there. Or drop `isLowStock` from the contract and keep the rule in the service.

### 2. Route reaches the database through `serializers.ts`
- Files: `server/src/modules/inventory/routes.ts:4,11` -> `server/src/modules/inventory/serializers.ts:1-3`
- Problem: chain `routes.ts -> serializers.ts -> db/client.js / db/schema/suppliers / drizzle-orm`. The grep on routes.ts looks clean, but the route performs a DB query (`withSupplierNames`) with the global `db` handle, outside the container (not overridable in tests). It also skips the service: the route calls `service.list()` and then enriches, so it orchestrates two steps instead of calling one service method.
- Fix: delete this `serializers.ts` DB access. Make `InventoryService.list()` return `InventoryItem[]` (with `supplierName`), resolving names via `new SupplierService(this.container)` or a supplier lookup method; the route becomes `app.get('/inventory', () => service.list())`. Any remaining serializer must be pure (no imports of db/drizzle).

### 3. Cross-module schema reach
- File: `server/src/modules/inventory/serializers.ts:3,11`
- Problem: the inventory module queries `db/schema/suppliers` directly, bypassing the suppliers module (its repository and rules, such as the NotFound handling). Persistence for suppliers belongs to `suppliers/repository.ts`.
- Fix: add a supplier-name lookup (for example `SupplierService.namesByIds(ids)`) behind `suppliers/service.ts` and call it from `InventoryService`.

### 4. Concrete SDK wrapper used in a service (no port, not mockable)
- Files: `server/src/lib/mailer.ts:1-3`, `server/src/modules/suppliers/service.ts:3,23`
- Problem: `lib/mailer.ts` is `new Resend(...)` exported as a singleton, i.e. the vendor itself. `SupplierService.notifyRestockNeeded` imports and calls it, which is the same violation as importing `resend` in a service. It cannot be swapped through `ContainerOverrides`, so tests would send real mail. The API key is read from `process.env` rather than the secrets provider. Nothing is registered in `container.ts`.
- Fix: all four steps: (a) port `Mailer { send(to, subject, text): Promise<void> }` in `shared/adapters.ts`; (b) `server/src/adapters/mailer/resend.ts` with the only `resend` import, wrapping failures in `ExternalServiceError`; (c) `MockMailer` in `adapters/mocks.ts`; (d) an async `container.mailer()` getter plus override. The service calls `(await this.container.mailer()).send(...)`. Delete `lib/mailer.ts`.

### 5. Drizzle row type leaks through an alias and out of the service
- Files: `server/src/modules/suppliers/types.ts:3`, `server/src/modules/suppliers/service.ts:6,15`, `server/src/modules/suppliers/repository.ts:4,9`
- Problem: `SupplierRow = typeof t.suppliers.$inferSelect` is a Drizzle type under a friendlier name. `SupplierService.get()` returns it publicly, and `reports/service.ts` consumes it, so the DB column shape crosses the boundary. `types.ts` also imports `db/schema` outside `repository.ts`.
- Fix: keep the row type local to `repository.ts`; add a Zod `Supplier` contract in shared (id, name, email) and map row -> `Supplier` in the repository or `helpers.ts`. `SupplierService.get()` returns `Supplier`. Remove `types.ts` (or make it hold only the domain type).

### 6. Report service reads another module's repository
- File: `server/src/modules/reports/service.ts:2,10`
- Problem: `new InventoryRepository(this.container.db)` skips `InventoryService` (restock/low-stock rules, any future filtering) and couples reports to inventory's persistence.
- Fix: use `new InventoryService(this.container).list()`. Note also that the loop does one supplier lookup per item (N+1); once item 2/3 are fixed, use the batched name lookup.

## Should fix

### 7. Import cycle between services
- Files: `server/src/modules/inventory/service.ts:4,41` <-> `server/src/modules/suppliers/service.ts:4,32`
- Problem: `InventoryService.requestRestock` constructs `SupplierService`, and `SupplierService.openItemCount` constructs `InventoryService`. A circular dependency between two services; each is only safe by lazy construction today.
- Fix: make the dependency one-way. Suppliers is lower in the order (inventory needs supplier info and mail; suppliers does not need inventory logic). Remove `openItemCount` from `SupplierService` and expose it from `InventoryService` (callers use `listBySupplier(...).length`), or put it in a read-only method that the inventory side owns.

## Minor / notes
- `server/src/modules/inventory/service.ts:35` duplicates the low-stock rule that `isLowStock` in the contract also defines. Keep one definition (see item 1).
- `server/src/modules/inventory/service.ts:45` re-exports `InventoryItem` unnecessarily; `PlainItem` (an `Omit` of a shared type, defined in `repository.ts`) is fine as a domain-typed shape, but consider moving it to shared so the service does not import a type from the repository file.
- `RestockBody` in `routes.ts` is acceptable transport validation; the range rule correctly lives in the service and throws `ValidationError`.
- The repository returns `PlainItem` (mapped), which is the intended shape; `drizzle-orm` in `inventory/repository.ts` and `suppliers/repository.ts` is fine.
- `reports/format.ts` and `reports/routes.ts` are clean.
- `platform/container.ts` has no ports or `ContainerOverrides` in this snapshot; the snapshot is minimal, so the mailer port work in item 4 should extend the real container.

Suggested lint rule (dependency-cruiser): forbid `src/vendor/shared/contracts/` -> `src/(modules|adapters|platform)/`, forbid `service.ts`/`routes.ts`/`serializers.ts` -> `db/` or `drizzle-orm`, and forbid `src/lib/` SDK wrappers being imported from `modules/*/service.ts`; enable `no-circular`.
