# Architecture review: inventory PR

Method: inventoried all 12 changed files, then followed every local import one hop (serializers, types, lib wrapper, cross-module imports, shared contract). Most problems are indirect, so a plain grep of `service.ts` for `drizzle-orm`/SDK names would only find one of them.

Not flagged (intended shape): services taking the whole `Container`, `new InventoryRepository(container.db)` / `new SupplierRepository(container.db)` inside services, `drizzle-orm` inside the two `repository.ts` files, `inventory/repository.ts` mapping `$inferSelect` rows to `PlainItem` before returning, services throwing `NotFoundError`/`ValidationError`.

## Findings

### 1. `inventory/routes.ts` -> `serializers.ts` -> `db/client.js` + `db/schema/suppliers` (transport reaches the database, bypasses service/repository)
- Chain: `routes.ts` imports `withSupplierNames` from `./serializers.js`, which imports `drizzle-orm` (`inArray`), the global `db` from `db/client.js`, and `db/schema/suppliers.js`, and runs a query.
- Why: the route (interface layer) performs persistence through a helper, skipping `service.ts` and `repository.ts`. A "serializer" file that queries the DB is really an unlayered repository. It also uses the module-global `db` instead of `container.db`, so tests cannot swap it, and it reads the suppliers table from inside the inventory module (cross-module schema reach).
- Fix: make `InventoryService.list()` return the complete `InventoryItem[]` (with `supplierName`). Resolve names via `SupplierService` (e.g. a `getNames(ids)` method backed by `SupplierRepository`), or a join inside inventory's own repository. Make `serializers.ts` a pure, DB-free mapper (or delete it). The route then calls exactly one service method.

### 2. `suppliers/service.ts` -> `lib/mailer.ts` -> `resend` (SDK wrapper used directly, no port)
- Chain: `service.ts` imports `mailer` from `lib/mailer.js`, which is `export const mailer = new Resend(process.env.RESEND_KEY ?? '')`.
- Why: a local module exporting a configured SDK client is the vendor itself. The application layer depends on Resend, the client is constructed at import time from `process.env` (not via `container.ts`), and it cannot be replaced through `ContainerOverrides`/a mock, so `notifyRestockNeeded` is untestable without sending mail. Resend errors would also leak out as vendor exceptions instead of `ExternalServiceError`. The hard-coded `from: 'ops@example.com'` is config living in the service.
- Fix: define a `Mailer`/`EmailSender` port in `@devdigest/shared/adapters.ts`, implement it in `server/src/adapters/mailer/` (the only file importing `resend`, wrapping failures in `ExternalServiceError`, reading the key and sender from config), add a mock in `adapters/mocks.ts`, register it in `platform/container.ts`, and have the service call `this.container.mailer.send(...)`. Delete `lib/mailer.ts`. Note `platform/errors.ts` has no `ExternalServiceError` yet; add it.

### 3. `suppliers/types.ts` + `suppliers/service.ts` (Drizzle `$inferSelect` alias leaks into the service signature)
- `types.ts` defines `SupplierRow = typeof t.suppliers.$inferSelect` and imports `db/schema/suppliers`. `SupplierService.get()` returns `Promise<SupplierRow>`, and `reports/service.ts` consumes it (`supplier?.name`).
- Why: this is a Drizzle type under a friendlier name exposed by a public service method, so the DB row shape (and any future column) leaks to every caller. The repository->service seam must map rows to a shared/domain type.
- Fix: add a `Supplier` Zod schema/type in `@devdigest/shared/contracts/` (id, name, email), have `SupplierRepository.get` map the row to it (as the inventory repository does with `toItem`), and change `SupplierService.get` to return `Supplier`. Keep `SupplierRow` private to `suppliers/repository.ts`.

### 4. `reports/service.ts` imports `inventory/repository.ts` (cross-module repository reach)
- `new InventoryRepository(this.container.db).list()` skips `InventoryService`, so any rule the inventory module applies is bypassed, and the reports module is coupled to inventory's persistence and its `PlainItem` type.
- Fix: call `new InventoryService(this.container).list()` (after fix 1 it returns complete items including `supplierName`, which also removes the per-item `suppliers.get` lookup below).

### 5. Module cycle: `inventory/service.ts` <-> `suppliers/service.ts`
- `InventoryService.requestRestock` constructs `SupplierService`; `SupplierService.openItemCount` constructs `InventoryService`. Each depends on the other, so neither can be understood, tested or moved alone.
- Fix: make the dependency one-directional. Suggested order: suppliers is lower, inventory calls suppliers. Move `openItemCount` out of `SupplierService` (e.g. into `ReportService`, which may call both services, or into `InventoryService` as a count by supplier). Then `SupplierService` no longer imports `InventoryService`.

### 6. `vendor/shared/contracts/inventory.ts` imports `modules/inventory/constants.js` (domain depends outward)
- The shared domain contract imports from a server module, and `@devdigest/shared` is also consumed by client, reviewer-core and e2e (and is copied to `client/src/vendor/shared`), so that import breaks outside `server/`. The inner layer must not import the outer one.
- Fix: contracts import only `zod`. Move `LOW_STOCK_THRESHOLD` into the shared package (e.g. a constant in the contract file), and let `inventory/constants.ts` import it from `@devdigest/shared`. Better still, drop `isLowStock` from the contract (it is behavior, not a shape) and keep that rule in `InventoryService`.

### 7. Smaller issues
- `InventoryService.lowStock()` duplicates the `quantity < LOW_STOCK_THRESHOLD` rule that also exists in `isLowStock` in the contract: one rule, two places. Keep it in one location (the service).
- `inventory/routes.ts` has `RestockBody` as `z.number().int()` while the service enforces 1..MAX_RESTOCK_QUANTITY; fine as layering, but a `ValidationError` from the service is the right place for the range rule (it already is). No change needed beyond keeping it there.
- `reports/service.ts` does one `suppliers.get` per item (N+1) inside a loop; resolved by fix 4 (names provided by the inventory service).
- New persistence has no port interface: both repositories are instantiated directly. Acceptable gap for existing style, but consider `IInventoryRepository` since this module is getting cross-module consumers.

## Summary table

| # | File | Problem | Severity |
|---|------|---------|----------|
| 1 | inventory/routes.ts -> serializers.ts -> db/client | route reaches DB via helper, global db | high |
| 2 | suppliers/service.ts -> lib/mailer.ts -> resend | SDK wrapper used directly, no port/mock/container | high |
| 3 | suppliers/types.ts, suppliers/service.ts | `$inferSelect` alias in service signature | medium |
| 4 | reports/service.ts | imports another module's repository | medium |
| 5 | inventory/service.ts <-> suppliers/service.ts | import cycle | medium |
| 6 | shared/contracts/inventory.ts | domain imports from `modules/` | high |
| 7 | misc | duplicated low-stock rule, N+1, no repo port | low |
