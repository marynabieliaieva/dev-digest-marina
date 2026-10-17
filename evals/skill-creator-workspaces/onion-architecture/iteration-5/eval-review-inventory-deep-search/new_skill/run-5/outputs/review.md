# Architecture review: inventory PR

Scope: the 12 files in `CHANGED.txt`, plus the unchanged files they import (`platform/container.ts`, `platform/errors.ts`, `modules/reports/format.ts`), followed one import hop. 7 problems found, each with the import chain.

## Blocking

### 1. Domain contract imports from a server module (inward layer depends outward)
- **File:** `server/src/vendor/shared/contracts/inventory.ts:2`
- **Chain:** `contracts/inventory.ts -> modules/inventory/constants.js`
- **Why:** `@devdigest/shared/contracts/*` is the domain center and may import only `zod`. It is shared with the other packages (`client/` gets a manual copy), and this import points at a server module path that does not exist there. It also reverses the dependency direction.
- **Fix:** Move `LOW_STOCK_THRESHOLD` into the contract file, or a shared constants file inside `vendor/shared`. Have `modules/inventory/constants.ts` import it or re-export it. Make `InventoryService.lowStock()` use the shared `isLowStock` instead of its own `i.quantity < LOW_STOCK_THRESHOLD`, so the rule lives in one place.

### 2. Route reaches the database through `serializers.ts` (indirect, wrapper-hidden)
- **File:** `server/src/modules/inventory/serializers.ts:1-3` (used by `routes.ts:4,11`)
- **Chain:** `routes.ts -> serializers.ts -> drizzle-orm`, `db/client.js` (global `db`), `db/schema/suppliers.js`
- **Why:**
  - A route handler is doing a DB query, which is the route-imports-drizzle violation one hop removed. `routes.ts` has no `drizzle-orm` import itself, so a plain grep misses it.
  - It uses the module-level `db` singleton instead of `container.db`, so tests cannot swap it through `ContainerOverrides`.
  - It reads the suppliers table directly, which skips the suppliers module's rules (see #5).
  - The route also calls two things (`service.list()` and then `withSupplierNames`), not exactly one service method.
- **Fix:**
  - Delete `serializers.ts`. Add `InventoryService.listWithSupplierNames()`.
  - Inside it, get names from `new SupplierService(this.container)` (for example a `getMany(ids)` method) or a repository join.
  - The route becomes `app.get('/inventory', () => service.listWithSupplierNames())`.
  - If a helper is still wanted, keep a pure function that takes a `Map<id, name>` and has no I/O.

### 3. Service imports an SDK wrapper (`lib/mailer.ts`, Resend) with no port
- **Files:** `server/src/lib/mailer.ts:1-3`, `server/src/modules/suppliers/service.ts:3,23`
- **Chain:** `suppliers/service.ts -> lib/mailer.ts -> resend`
- **Why:**
  - `lib/mailer.ts` is a configured Resend client (`new Resend(process.env.RESEND_KEY)`), so it is the vendor. Importing it from a service is the same violation as importing `resend`.
  - The env var is read at import time, bypassing the secrets provider.
  - It cannot be mocked through `ContainerOverrides`, so any test of `notifyRestockNeeded` would send real mail.
  - None of the four wiring steps for a new integration exist (port, adapter, mock, container).
- **Fix:**
  1. Add an `EmailClient` port (`send({to, subject, text})`) in `vendor/shared/adapters.ts`.
  2. Add `server/src/adapters/email/resend.ts`, the only file importing `resend`. It takes the key from `secrets`, and wraps failures in `ExternalServiceError`.
  3. Add `MockEmailClient` to `adapters/mocks.ts`.
  4. Add an async `container.email()` getter with an override in `ContainerOverrides`.
  5. In the service, use `(await this.container.email()).send(...)`.
  6. Delete `lib/mailer.ts`. Also move the hard-coded `from: 'ops@example.com'` to config or constants.

### 4. Drizzle `$inferSelect` alias leaks through the service signature
- **Files:** `server/src/modules/suppliers/types.ts:3`, `suppliers/service.ts:6,15`, `suppliers/repository.ts:4,9`
- **Chain:** `suppliers/service.ts -> types.ts -> db/schema/suppliers.js` (`typeof t.suppliers.$inferSelect`)
- **Why:** `SupplierRow` is a Drizzle row type under a friendlier name. `SupplierService.get()` returns it publicly, and `ReportService` consumes it (`supplier?.name`). So the DB column shape crosses the service boundary into other modules. `types.ts` also imports the db schema directly.
- **Fix:**
  - Define a `Supplier` Zod schema and type in `vendor/shared/contracts/` (copy it to `client/src/vendor/shared` by hand).
  - Keep the raw row type private to `repository.ts` and map it there or in `helpers.ts` (`toSupplierDto`).
  - Make `SupplierRepository.get` and `SupplierService.get` return `Supplier`.
  - Delete `types.ts`.

### 5. Cross-module reach into another module's repository
- **File:** `server/src/modules/reports/service.ts:2,10`
- **Chain:** `reports/service.ts -> inventory/repository.ts -> db/schema/inventory.js, drizzle-orm`
- **Why:** `new InventoryRepository(this.container.db).list()` skips `InventoryService` and its business rules. It also couples reports to inventory's persistence layout.
- **Fix:** Use `new InventoryService(this.container).list()`. A module's service is the only allowed entry point into it. As a side improvement, the per-item `await suppliers.get()` is an N+1 query, so batch with a `getMany(ids)` (shared with #2).

### 6. Import cycle between the inventory and suppliers services
- **Files:** `server/src/modules/inventory/service.ts:4,41` and `server/src/modules/suppliers/service.ts:4,32`
- **Chain:** `InventoryService -> SupplierService -> InventoryService`
- **Why:** `requestRestock` calls `SupplierService.notifyRestockNeeded`, and `openItemCount` calls `InventoryService.listBySupplier`. Neither module can be understood or tested without the other, and the ESM cycle can break at load time.
- **Fix:** Pick one direction. Inventory depends on suppliers (it already needs supplier names and notifications), so remove `SupplierService.openItemCount` and the `InventoryService` import from the suppliers service. If a supplier-level count is needed, expose it from `InventoryService` (callers go inventory -> suppliers only) or have the caller compose the two.

## Minor / advisory

### 7. Container is not extended, and persistence has no interface
- **Files:** `server/src/platform/container.ts`, `inventory/service.ts:12`, `suppliers/service.ts:12`
- **Why:**
  - The container exposes only `db`, with no `ContainerOverrides` and no ports. This is why #3 cannot be mocked.
  - Building `new XRepository(container.db)` in the service is the accepted pattern and is not a violation.
  - Inventory now has real rules (restock limits, low-stock, cross-module notify), so consider an `IInventoryRepository`-style interface so the service can be unit-tested with a fake.
- **Fix:** Add the `email()` getter plus overrides as in #3. Optionally introduce a repository interface for the inventory and suppliers repositories.

## Checked and fine (not violations)
- `inventory/repository.ts`: Drizzle is allowed here. `ItemRow` stays private and rows are mapped to `PlainItem`, a shared-derived type.
- `inventory/service.ts` and `suppliers/service.ts` take the whole `Container` and build their own repository.
- Errors use `NotFoundError` and `ValidationError` from `platform/errors.ts`, and no route builds a 4xx body by hand.
- `reports/format.ts` is a pure helper, and `reports/routes.ts` is a thin single-call route.
- `inventory/routes.ts` restock handler: parse, one service call.
