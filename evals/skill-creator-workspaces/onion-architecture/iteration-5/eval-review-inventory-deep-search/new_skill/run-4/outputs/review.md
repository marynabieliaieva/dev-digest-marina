# Architecture review: inventory PR

Method: inventoried all changed files and followed each service/route's local imports one hop (and further where needed), per the skill's "Searching for Indirect Violations". Direct greps of `service.ts` / `routes.ts` for `drizzle-orm` find nothing; the problems are indirect.

## Problems

### 1. Domain contract imports from an outer layer (blocker)
- **File:** `server/src/vendor/shared/contracts/inventory.ts:2`
- **Why:** `@devdigest/shared/contracts/*` is the center of the onion and may import only `zod`. It imports `LOW_STOCK_THRESHOLD` from `modules/inventory/constants.js` (an application-layer module), so the inward layer depends outward. It also breaks the shared package for `client/` and `mcp/`, which copy it.
- **Fix:** Move the threshold into the contract file (or a shared constants file inside `shared`) and have `modules/inventory/constants.ts` / `service.ts` import it from `@devdigest/shared`. This also removes the duplicated rule: `service.lowStock()` hard-codes `i.quantity < LOW_STOCK_THRESHOLD` while the contract has `isLowStock`. Use `isLowStock` in one place.

### 2. Routes reach the database transitively via `serializers.ts` (blocker)
- **Chain:** `inventory/routes.ts → inventory/serializers.ts → db/client.js, db/schema/suppliers.js, drizzle-orm`
- **File:** `server/src/modules/inventory/serializers.ts:1-3` (imported at `routes.ts:4`)
- **Why:** The "serializer" is really a query. It imports `drizzle-orm`, the global `db` handle and the suppliers table, and `routes.ts` calls it directly (`withSupplierNames(await service.list())`). That skips `service.ts`/`repository.ts`, puts enrichment logic (join of supplier names) in the transport layer, cannot be mocked through `ContainerOverrides` (it uses the global `db`, not `container.db`), and reads another module's schema (`db/schema/suppliers`) bypassing the suppliers module.
- **Fix:** Delete the DB access from `serializers.ts`. Have `InventoryService.list()` return `InventoryItem[]` with `supplierName` filled in, obtaining names through `new SupplierService(this.container)` (or a repository join inside `InventoryRepository`). `routes.ts` then calls one service method and returns the result. Keep `serializers.ts` only for pure transforms, if needed.

### 3. Vendor SDK wrapper used by a service, no port (blocker)
- **Chain:** `suppliers/service.ts → lib/mailer.ts → resend`
- **File:** `server/src/modules/suppliers/service.ts:3,23`; `server/src/lib/mailer.ts`
- **Why:** `lib/mailer.ts` exports a configured `new Resend(...)` client, so it is the SDK itself. `SupplierService` calls `mailer.emails.send` directly, so it is a new external integration with no port, no adapter, no mock, and not swappable via `ContainerOverrides` (tests will send real email or need module mocking). It also reads `process.env` at import time and leaks Resend's API shape into the application layer; vendor errors are not wrapped in `ExternalServiceError`.
- **Fix:** Add a `Mailer` port (e.g. `send({to, subject, text})`) to `@devdigest/shared/adapters.ts`; implement it in `server/src/adapters/mailer/` (the only file importing `resend`, wrapping failures in `ExternalServiceError`); add a mock in `adapters/mocks.ts`; register it in `platform/container.ts` (plus `ContainerOverrides`). `SupplierService` then uses `this.container.mailer`. Remove `lib/mailer.ts`.

### 4. Drizzle `$inferSelect` alias leaks into the service signature
- **Files:** `server/src/modules/suppliers/types.ts:3`, used in `suppliers/repository.ts:4` and `suppliers/service.ts:6,15`
- **Why:** `SupplierRow` is `typeof t.suppliers.$inferSelect` under a friendlier name. `SupplierService.get()` returns it publicly, so the raw Drizzle row (and `reports/service.ts`, which consumes it) escapes the repository/service seam. `types.ts` also imports `db/schema/*` outside a repository.
- **Fix:** Define a domain `Supplier` type as a Zod contract in `@devdigest/shared/contracts/` (or a plain type), map the row to it inside `SupplierRepository` (like `InventoryRepository.toItem`), and have the service return that. Delete or repurpose `types.ts` so it no longer imports the schema.

### 5. Import cycle between inventory and suppliers services
- **Files:** `inventory/service.ts:4,41` (`new SupplierService`) and `suppliers/service.ts:4,32` (`new InventoryService`)
- **Why:** `InventoryService → SupplierService → InventoryService` is a module cycle: fragile initialization, tangled responsibilities, hard to test in isolation.
- **Fix:** Pick one direction. Suppliers is lower-level: keep `inventory → suppliers` (needed for names and `notifyRestockNeeded`) and drop `SupplierService.openItemCount`; compute open item count in `InventoryService` (it already has `listBySupplier`), or expose it from a route/service that sits above both. Note `listBySupplier` then becomes unused by suppliers.

### 6. Reports service reaches into another module's repository
- **File:** `server/src/modules/reports/service.ts:2,10`
- **Why:** `new InventoryRepository(this.container.db)` bypasses the inventory module's service and its business rules (and its enrichment/validation). Cross-module calls must go through the other module's `service.ts`.
- **Fix:** Use `new InventoryService(this.container).list()` and, for supplier names, the already-enriched list from fix 2 (which also removes the per-item `await suppliers.get(...)` N+1 loop here). `format.ts` is a pure helper and is fine.

## Lower-severity notes
- `inventory/routes.ts:14` — `RestockBody.parse` throws a raw `ZodError`. Confirm the central error handler maps it to the `{ error: { code, message, details } }` envelope; otherwise use `safeParse` and throw `ValidationError`. Also the service re-checks `amount` bounds, so keep the single rule (service) and let the route only check shape.
- `InventoryService.list()` returns `PlainItem` (a repository-defined `Omit<InventoryItem,...>`). Once fix 2 lands, return the shared `InventoryItem` from the service instead of a repository-local type.
- Repositories have no interface (known repo-wide gap); acceptable, but `InventoryRepository` is now used from two modules, which is another reason to route access through the service.

## Not violations (checked)
- `InventoryRepository` / `SupplierRepository` using `drizzle-orm` and `db/schema/*` (intended place).
- Services taking the whole `Container` and building their own repository.
- `NotFoundError` / `ValidationError` from `platform/errors.ts` in services.
- `reports/format.ts`, `reports/routes.ts` (thin, transport-only).
