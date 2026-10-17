# Architecture review: inventory PR (onion-architecture)

Scope: the 12 files in CHANGED.txt, plus `platform/container.ts` and `platform/errors.ts` read for context. Dependency rule: an import may only point inward. `routes.ts` goes only to its `service.ts`. `service.ts` goes only through ports and its own repository. Only `repository.ts` touches Drizzle. Only adapters touch SDKs.

## Problems

### 1. `server/src/modules/inventory/serializers.ts` - DB access outside the repository, and routes reach the DB through it
- Why: it imports `drizzle-orm`, the global `db` from `db/client.js` and `db/schema/suppliers.js`. Only `repository.ts` may do this, and this file is not a repository. `routes.ts` calls `withSupplierNames()` directly, so the route reaches persistence and skips the service. It also bypasses `container.db`, so tests cannot inject a different DB. It reads another module's table (suppliers) directly. Supplier-name enrichment is business logic, and it sits in the transport path.
- Fix: delete the file. Fetch supplier names in `InventoryRepository` (a join or a `listWithSupplier()` method) or through `SupplierService`. Have `InventoryService.list()` return the finished `InventoryItem[]`. The route becomes `app.get('/inventory', () => service.list())`.

### 2. `server/src/modules/inventory/routes.ts` - calls more than one layer
- Why: the GET handler calls `service.list()` and then `withSupplierNames` (problem 1). The route should call exactly one service method.
- Fix: as in 1. The route parses the request, calls one service method and returns the result.

### 3. `server/src/vendor/shared/contracts/inventory.ts` - domain layer imports from an outer layer
- Why: the contract imports `LOW_STOCK_THRESHOLD` from `../../../modules/inventory/constants.js`. The innermost layer (shared contracts, Zod only) now depends on a server module, and `client/` and `mcp/` consume this file. It also puts a business rule (`isLowStock`) in a schema file.
- Fix: keep the contract as the Zod schema and inferred type only. Move `isLowStock` and the threshold into the inventory module (`helpers.ts`/`constants.ts`), or inline the constant inside `shared`. Remember the manual copy to `client/src/vendor/shared`.

### 4. `server/src/lib/mailer.ts` and `server/src/modules/suppliers/service.ts` - SDK used directly, no port
- Why: `mailer.ts` creates a `Resend` client at module load, as a global singleton reading `process.env`. `suppliers/service.ts` imports it and calls `mailer.emails.send` itself. Application code is tied to a concrete vendor SDK. It cannot be swapped for a mock through `ContainerOverrides`, so tests would send real mail. The `lib/` location sits outside the adapters/container pattern. The sender address and message text are hard-coded in the service.
- Fix: follow the four-step integration recipe.
  1. Add an `EmailSender` port to `@devdigest/shared/adapters.ts`.
  2. Add a `ResendEmailSender` adapter in `server/src/adapters/email/`. Only this file imports `resend`, and it reads the key from config or the secrets provider.
  3. Add a mock in `adapters/mocks.ts`.
  4. Register it in `platform/container.ts` with an override.
  Then `SupplierService` calls `this.container.email.send(...)`. Delete `lib/mailer.ts`.

### 5. `server/src/modules/suppliers/types.ts` and `suppliers/service.ts` - Drizzle `$inferSelect` leaks out of the service
- Why: `SupplierRow = typeof t.suppliers.$inferSelect` imports `db/schema` outside `repository.ts`. `SupplierService.get()` returns `SupplierRow` publicly, and `reports/service.ts` consumes it. A raw DB row shape (including `email`) crosses the service boundary.
- Fix: define a `Supplier` contract (Zod, in `shared/contracts`). Have `SupplierRepository` map rows to it, as `repos` does with `toRepoDto`. `SupplierService.get()` returns `Supplier`. Delete `types.ts`, or keep a row type private inside `repository.ts`.

### 6. Circular dependency between `inventory/service.ts` and `suppliers/service.ts`
- Why: `InventoryService.requestRestock` constructs `SupplierService`, and `SupplierService.openItemCount` constructs `InventoryService`. The modules depend on each other in both directions, which risks module-load cycles and makes them hard to test in isolation.
- Fix: keep the dependency one-way. `inventory -> suppliers` is acceptable. Drop `openItemCount` from `SupplierService`, or compute it in `InventoryService` or a higher-level orchestrator (e.g. reports).

### 7. `server/src/modules/reports/service.ts` - reaches into another module's repository, with an N+1
- Why: it imports `InventoryRepository` from `../inventory/repository.js` and instantiates it with `container.db`. That skips the inventory service and its rules. Cross-module calls must go through the other module's service. It also calls `suppliers.get()` once per item inside a loop (N+1 queries), and `get()` throws `NotFoundError` on a missing supplier, which would fail the whole report.
- Fix: use `new InventoryService(this.container).list()`. Once problem 1 is fixed, items already carry `supplierName`, so no per-item lookup is needed. Keep `format.ts` as the pure formatter.

### 8. `server/src/modules/inventory/service.ts` - returns a repository-internal type and duplicates a domain rule
- Why: the public API returns `PlainItem` (defined in `repository.ts`) rather than the shared `InventoryItem`. That is why the route needed a serializer (problem 1). `lowStock()` re-implements the threshold rule that `isLowStock` in the contract also encodes, so there are two copies. `export type { InventoryItem }` re-exports a shared type through the service for no reason.
- Fix: the service returns `InventoryItem`. Keep the low-stock rule in one place (see 3). Drop the re-export. Constructing `new SupplierService(this.container)` at the call site is the accepted pattern.

### 9. Smaller notes
- `inventory/repository.ts`: `PlainItem` is acceptable (rows are mapped before leaving), but prefer a shared type. No repository interface exists. This is the known persistence gap; optional here, but mention it in the PR notes.
- Restock bounds are checked in two places: the route only checks `int()`, the service checks `1..MAX_RESTOCK_QUANTITY`. Not a layering violation, but keep one source of truth.
- `platform/container.ts` is a stub in this snapshot (only `db`), so the email port from problem 4 needs adding there.

## Correct as is
- `inventory/repository.ts` and `suppliers/repository.ts`: Drizzle only here (the supplier repository returns the raw row, see 5).
- `reports/routes.ts`: thin, one service call.
- `reports/format.ts`: pure helper.
- `platform/errors.ts` and `inventory/constants.ts`: no outward imports.

## Priority
1. Email port (4), serializer DB access (1/2), contract importing a module (3).
2. `$inferSelect` leak (5), circular dependency (6), reports reaching into the repository (7).
3. Cleanups (8, 9).
