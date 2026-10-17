# Architecture review: inventory PR (onion-architecture)

Scope: the 12 files in CHANGED.txt plus the unchanged files they touch (`reports/format.ts`, `platform/*`). Dependency rule: imports only point inward (routes -> service -> repository/ports -> domain). Only `repository.ts` may touch Drizzle/`db/*`, only an adapter may import an SDK.

## Findings

### 1. `server/src/lib/mailer.ts` and `server/src/modules/suppliers/service.ts`: Resend SDK used with no port (BLOCKER)
- Why: `mailer.ts` does `new Resend(...)` at module scope in `lib/`, and `SupplierService.notifyRestockNeeded` imports it and calls `mailer.emails.send`. This is a new external integration that skips the required port, adapter, mock and container registration. It cannot be swapped via `ContainerOverrides`, so tests would send real mail. The `resend` SDK shape leaks into the application layer. Reading `process.env` at import time also bypasses config.
- Fix: add a `Mailer` port (`send({to, subject, text})`) in `@devdigest/shared/adapters.ts`; implement it in `server/src/adapters/mailer/` (the only file that imports `resend`); add a mock in `adapters/mocks.ts`; register it in `platform/container.ts` (plus `ContainerOverrides`). The service calls `this.container.mailer.send(...)`. Delete `lib/mailer.ts`. Move the hardcoded `from: 'ops@example.com'` into config or the adapter.

### 2. `server/src/vendor/shared/contracts/inventory.ts`: domain layer imports from an outer layer (BLOCKER)
- Why: the shared contract imports `LOW_STOCK_THRESHOLD` from `../../../modules/inventory/constants.js`. The innermost layer now depends on a server module, and the contract (which is copied to `client/src/vendor/shared`) would break there. It also puts a business rule (`isLowStock`) in a Zod contract file.
- Fix: contracts import `zod` only. Put the threshold in the shared package (or drop `isLowStock` from the contract). Have `InventoryService.lowStock` own the rule and pass the threshold in. Remember the manual copy to the client vendor dir.

### 3. `server/src/modules/inventory/serializers.ts`: raw Drizzle and global `db` outside a repository (BLOCKER)
- Why: it imports `drizzle-orm`, `db/client.js` and `db/schema/suppliers.js` directly, in a file that is neither `repository.ts` nor behind it. It also uses the global `db` rather than the container's, so it can't be overridden in tests. It queries another module's table (suppliers), crossing a module boundary through the database.
- Fix: delete the file. Do the enrichment in `InventoryRepository` (a left join on suppliers in `list()`) or via `SupplierService` called from `InventoryService.list()`, and return `InventoryItem` with `supplierName` from the service.

### 4. `server/src/modules/inventory/routes.ts`: handler reaches past the service (HIGH)
- Why: `GET /inventory` calls `service.list()` then `withSupplierNames(...)`, which is a data-access step living in the transport layer. Routes should parse the request, call exactly one service method and map the result. This also makes `service.list()` return `PlainItem` (without `supplierName`) while the endpoint returns `InventoryItem`, so the service contract does not match the API.
- Fix: after finding 3, the route is just `service.list()`. The service returns the full `InventoryItem[]`.

### 5. `server/src/modules/suppliers/types.ts` and `suppliers/service.ts`: Drizzle `$inferSelect` leaks through the service (HIGH)
- Why: `SupplierRow = typeof t.suppliers.$inferSelect` is defined in `types.ts`, imports `db/schema/*` from outside `repository.ts`, and `SupplierService.get()` returns it publicly. `ReportService` consumes it. The Drizzle row type may exist only at the repository/service seam and must be mapped to a shared domain type before leaving the service.
- Fix: add a `Supplier` Zod contract in `@devdigest/shared/contracts`; map row -> `Supplier` inside `SupplierRepository` (or `helpers.ts`); have the repository and service return `Supplier`; remove `types.ts`' schema import.

### 6. `server/src/modules/reports/service.ts`: imports another module's repository (HIGH)
- Why: `new InventoryRepository(this.container.db)` reaches into the inventory module's persistence layer, bypassing `InventoryService` and its rules. Cross-module calls must go through the other module's service.
- Fix: `new InventoryService(this.container).list()`. While there, avoid the N+1 `suppliers.get()` loop; use the enriched `supplierName` from finding 3.

### 7. Circular dependency: `inventory/service.ts` <-> `suppliers/service.ts` (HIGH)
- Why: `InventoryService.requestRestock` constructs `SupplierService`, and `SupplierService.openItemCount` constructs `InventoryService` (`listBySupplier`). The two modules import each other, which will cause init-order bugs and means neither can be understood or tested alone.
- Fix: break the cycle. Move `openItemCount` out of suppliers (the count is inventory's concern, e.g. `InventoryService.countBySupplier`), or let a caller/orchestrator compose the two. Keep the dependency one-directional (inventory -> suppliers).

### 8. Minor / advisory
- `inventory/service.ts`: `lowStock()` duplicates `isLowStock` logic from the contract; keep one source (the service) after finding 2. The trailing `export type { InventoryItem }` re-export is unnecessary.
- `inventory/repository.ts`: `PlainItem = Omit<InventoryItem,'supplierName'>` is a half-domain type exported from the repository and used in the service signatures. Prefer the full shared type once enrichment moves into the repository/service.
- `inventory/repository.ts` and `suppliers/repository.ts`: no repository interface exists (known repo-wide gap). With cross-module and growing query logic here, consider an interface so services can be tested against a mock.
- `inventory/routes.ts`: `RestockBody` only checks `int`; range validation lives in the service (acceptable). No `requestRestock` route exists, so that code path is currently unreachable.
- `reports/format.ts` and `reports/routes.ts`: fine (pure helper; routes only call one service method).

## Summary
3 blockers (direct SDK without a port, inward layer importing outward, raw Drizzle outside the repository), 4 high (route bypassing service, Drizzle type leaking from the service, cross-module repository access, circular module dependency), plus minor items. Not ready to open until the blockers are fixed.
