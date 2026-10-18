# Architecture review: inventory PR

Scope: the 12 files in `CHANGED.txt`, plus the unchanged files they import (`reports/format.ts`, `platform/container.ts`, `platform/errors.ts`). I walked the import graph one hop out from every `service.ts` and `routes.ts`. Several leaks are not visible in a single-file grep.

Verdict: **do not open the PR yet.** There are 7 problems; 1-6 are blocking.

## Import graph found

```
inventory/routes.ts    -> inventory/serializers.ts -> drizzle-orm, db/client.js, db/schema/suppliers.js
suppliers/service.ts   -> lib/mailer.ts            -> resend (SDK client instance)
suppliers/service.ts   -> suppliers/types.ts       -> db/schema/suppliers.js  ($inferSelect alias)
inventory/service.ts  <-> suppliers/service.ts     (cycle)
reports/service.ts     -> inventory/repository.ts  (other module's repository)
vendor/shared/contracts/inventory.ts -> modules/inventory/constants.ts  (domain -> outer layer)
```

## Problems

### 1. `server/src/modules/inventory/routes.ts` -> `serializers.ts` -> Drizzle / db (transport layer reaches the database)
- **Chain:** `routes.ts` imports `withSupplierNames` from `serializers.ts`. That file imports `drizzle-orm`, `db/client.js` and `db/schema/suppliers.js`, and runs a query.
- **Why:** `GET /inventory` calls `service.list()` and then passes the result to a function that queries Postgres. The route does orchestration and persistence, one import hop away from where a grep would look. It also bypasses `service.ts` and `repository.ts`; uses the global `db` instead of `container.db` (tests cannot inject a fake); and reads the suppliers table from the inventory module (see #5).
- **Fix:** Delete `serializers.ts`. Make `InventoryService.list()` return `InventoryItem[]` (with `supplierName`), getting names through `new SupplierService(this.container)` (e.g. a `getNames(ids)` method backed by `SupplierRepository`) or a join inside `InventoryRepository`. The route becomes `app.get('/inventory', () => service.list())`.

### 2. `server/src/modules/suppliers/service.ts` -> `server/src/lib/mailer.ts` (concrete SDK used by the application layer)
- **Chain:** `service.ts` -> `lib/mailer.ts` -> `resend`. `mailer.ts` exports a configured `new Resend(process.env.RESEND_KEY)`.
- **Why:** The wrapper is the vendor SDK; importing it from a service is the same violation as importing `resend`. It reads `process.env` at import time, cannot be replaced through `ContainerOverrides` (tests would send real email), and the service hard-codes the `from` address.
- **Fix:**
  1. Add a `Mailer` port (`send({ to, subject, text })`) to `vendor/shared/adapters.ts`.
  2. Implement `ResendMailer` in `server/src/adapters/mailer/resend.ts`, the only file allowed to import `resend`; wrap vendor errors in `ExternalServiceError`.
  3. Add `MockMailer` to `adapters/mocks.ts`.
  4. Add an async `container.mailer()` getter in `platform/container.ts` with a `ContainerOverrides` entry (key from the secrets provider).
  5. In the service: `const mailer = await this.container.mailer()`.
  6. Delete `lib/mailer.ts`.

### 3. `server/src/modules/suppliers/types.ts` (Drizzle `$inferSelect` alias leaks through the service)
- **Chain:** `types.ts` defines `SupplierRow = typeof t.suppliers.$inferSelect` and imports `db/schema` outside `repository.ts`. It is used in the public signature `SupplierService.get(): Promise<SupplierRow>`.
- **Why:** The friendly name hides a raw Drizzle row type. The DB column shape flows out of the service to every caller, including `reports/service.ts` (`supplier?.name`).
- **Fix:** Keep `SupplierRow` private to `repository.ts` and delete `types.ts`. Add a `Supplier` Zod contract in `vendor/shared/contracts/`; map row to `Supplier` in the repository or a `toSupplierDto` in `helpers.ts`. `SupplierService.get()` returns `Supplier`.

### 4. `inventory/service.ts` <-> `suppliers/service.ts` (import cycle)
- **Chain:** `InventoryService.requestRestock` does `new SupplierService(...)`; `SupplierService.openItemCount` does `new InventoryService(...)`. Each file imports the other.
- **Why:** The modules cannot be loaded, understood or tested independently, and module-evaluation order can break at runtime. Neither sits lower in the dependency order.
- **Fix:** Make it one-way. Suppliers is the lower module, so remove `openItemCount` from `SupplierService`; compute the count in `InventoryService` (it already has `listBySupplier`) or in the caller. Inventory may keep calling `new SupplierService(this.container)`.

### 5. `server/src/modules/reports/service.ts` -> `inventory/repository.ts` (cross-module repository access)
- **Why:** `ReportService` builds `new InventoryRepository(this.container.db)`, skipping `InventoryService`, so any rule added there later is silently bypassed by reports. `PlainItem` is exposed to another module. (Same cross-module reach in `inventory/serializers.ts`, which imports `db/schema/suppliers`; fix #1 removes it.)
- **Fix:** Use `new InventoryService(this.container).list()`. If `list()` returns supplier names (fix #1), the per-item `suppliers.get()` loop (an N+1 query) can go away. `reports/format.ts` is fine (pure formatting).

### 6. `server/src/vendor/shared/contracts/inventory.ts` -> `modules/inventory/constants.ts` (domain depends on an outer layer)
- **Why:** The contract is the center of the onion and is also copied to `client/src/vendor/shared`. Importing `LOW_STOCK_THRESHOLD` from a server module is the inward layer depending outward, and it breaks the client copy (that path does not exist there).
- **Fix:** Put `LOW_STOCK_THRESHOLD` in the shared contract (or a shared constants file); have `modules/inventory/constants.ts` import or re-export it from `@devdigest/shared`, never the reverse. Copy the change to the client vendor folder by hand.
- Related: `InventoryService.lowStock()` re-implements `quantity < LOW_STOCK_THRESHOLD` instead of using `isLowStock`. Use the domain function so there is one definition.

### 7. Minor / design notes (non-blocking)
- `RestockBody` accepts any integer while the real rule (1..`MAX_RESTOCK_QUANTITY`) lives in the service. Acceptable; keep the range check in the service only.
- `InventoryService` has an unused `export type { InventoryItem }` re-export, and returns `PlainItem` (defined in `repository.ts`) as its public type. Prefer the shared `InventoryItem`.
- The repositories have no interface. For a module with growing query logic consider an `IInventoryRepository` so the service can be tested against a mock. Advice only.
- `restock` is a non-atomic read-modify-write (`get` then `setQuantity`), so concurrent restocks can lose updates. Not an architecture problem; use an atomic `quantity = quantity + n` update.

## Checked and fine (not violations)
- Services take the whole `Container` and build their own repository with `container.db`.
- `drizzle-orm` and `db/schema` imports inside `repository.ts` files.
- The one-way `new SupplierService(this.container)` call from `InventoryService` (once the cycle in #4 is gone).
- Failure paths use `NotFoundError` / `ValidationError` from `platform/errors.ts`; no hand-built error bodies in routes.
- `reports/routes.ts` is transport-only; `reports/format.ts` is pure.

## Suggested fix order
1. #6 (contract import), because it also affects the client copy.
2. #3 and #2 (types, mailer port).
3. #4, then #1 and #5 (cycle, serializer, reports).
