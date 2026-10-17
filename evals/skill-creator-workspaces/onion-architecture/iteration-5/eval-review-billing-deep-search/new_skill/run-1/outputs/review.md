# Architecture review: billing PR

Scope: the 9 files in CHANGED.txt, plus the files they import (customers/repository, notifications/*, platform/*). Local imports were followed one hop from every `service.ts` and `routes.ts`.

Verdict: do not open yet. 7 violations, 5 of them blocking.

## Blocking

### 1. `billing/service.ts` imports the Stripe client through a wrapper (`lib/payments.ts`)
- Chain: `billing/service.ts:4` -> `lib/payments.ts:3` (`export const stripe = new Stripe(...)`).
- Why: `lib/payments.ts` is the vendor SDK under a local name. A service using it is the same violation as importing `stripe` directly. There is no port, so `ContainerOverrides` can't swap it for a mock, and tests would hit Stripe. The `new Stripe(...)` also runs at import time, reading `process.env` outside the container.
- Fix:
  1. Add a `PaymentsProvider` port (e.g. `createInvoice({ customerExternalId, description })`) to `@devdigest/shared/adapters.ts`.
  2. Implement it in `server/src/adapters/payments/` (the only file that imports `stripe`). Wrap vendor errors in `ExternalServiceError`.
  3. Add a mock in `adapters/mocks.ts`.
  4. Register it in `platform/container.ts` with a `ContainerOverrides` entry.
  5. In the service, call `this.container.payments.createInvoice(...)`. Delete `lib/payments.ts`.

### 2. `billing/helpers.ts` talks to the database directly
- Chain: `billing/service.ts:9` -> `billing/helpers.ts:1-3` (`drizzle-orm`, `db/client.js`, `db/schema/billing.js`).
- Why: `nextInvoiceNumber()` runs a query with the global `db` singleton. This is the Drizzle/DB leak, one hop away from the service, and a literal grep for `drizzle-orm` in `service.ts` misses it. `helpers.ts` is meant for pure transforms. It also bypasses the container's `db`, so it can't be tested against an injected one. The count+1 numbering is also race-prone.
- Fix: move `nextInvoiceNumber` into `InvoiceRepository` (taking `this.db`), ideally a DB sequence or an atomic insert. Keep only pure code (`formatAmount`) in `helpers.ts`.

### 3. `billing/service.ts` leaks a Drizzle type: `InvoiceRow`
- Chain: `billing/types.ts:3` (`typeof t.invoices.$inferSelect`) -> imported by `service.ts:11` -> `getRow(): Promise<InvoiceRow | null>` (`service.ts:39`). The repository exposes it through `getRow` (`repository.ts:25`).
- Why: `InvoiceRow` is a `$inferSelect` alias, so a public service method returns a raw Drizzle row. Outside the repository, callers couple to the table shape. `types.ts` also imports `db/schema/billing.js` into a non-repository file.
- Fix: delete `getRow` from the service and repository, or make both return the shared `Invoice` type. Keep the row alias private to `repository.ts`, or move it there and delete the `InvoiceRow` export from `types.ts`. Leave only `InvoiceStatus` in `types.ts`, or better, use the shared contract type.

### 4. Cross-module reach into `CustomerRepository`
- File: `billing/service.ts:5,25` (`new CustomerRepository(this.container.db).get(customerId)`).
- Why: it skips `CustomerService` and its business rules (it only checks existence, not `active`). Billing now depends on the customers persistence layer.
- Fix: use `new CustomerService(this.container).get(customerId)`. It already throws `NotFoundError`, so the manual null check can go.

### 5. `customers/routes.ts` bypasses its own service and uses another module's repository
- File: `customers/routes.ts:3,7,14` (`InvoiceRepository` from `../billing/repository.js`, `invoices.listForCustomer(...)`).
- Why: a route handler is calling a repository directly, and one that belongs to a different module. This is transport reaching into infrastructure and skipping `BillingService`. The route also makes two calls (`service.get`, then the repository) instead of one service method.
- Fix: add `listInvoicesForCustomer(customerId)` to `BillingService`, or to `CustomerService` calling `new BillingService(container)`. The route then calls exactly one service method. Remove the `InvoiceRepository` import from the route.

### 6. Import cycle: `billing/service.ts` <-> `customers/service.ts`
- Files: `billing/service.ts:6,44` (`CustomerService.assertActive`) and `customers/service.ts:4,26` (`BillingService.totalOutstanding`).
- Why: the two services depend on each other. This makes module load order fragile and couples the two modules in both directions.
- Fix: pick one direction. Billing depends on customers, which is already needed for create. Then `canBeDeactivated` should not call `BillingService`. Either move that check into `BillingService` (e.g. `BillingService.canCustomerBeDeactivated`) and have whoever deactivates customers call it, or have the caller pass in the outstanding amount. Alternatively, move the shared "outstanding" query into a repository method that both services use.

## Non-blocking

### 7. Persistence is not behind an interface for the new module
- Files: `billing/service.ts:17` (and `notifications`, `customers`, which follow the same pattern).
- Why: `new InvoiceRepository(container.db)` matches the existing un-inverted persistence pattern. It's acceptable, but billing has real query logic (numbering, outstanding). The layer-map recommends considering an `IInvoiceRepository` so the service can be tested against a mock.
- Fix: consider the interface, at least for `InvoiceRepository`.

## Checked and fine (not reported)
- `billing/routes.ts`: parse -> one service call -> status. No SDK or DB imports.
- `billing/repository.ts`, `customers/repository.ts`, `notifications/repository.ts`: Drizzle only here, mapping rows to the shared `Invoice` / `Customer` types.
- `billing/constants.ts`: literals only.
- `new NotificationService(this.container).record(...)` is the intended one-way module call.
- Error handling: `NotFoundError`, `ValidationError` and `ConflictError` come from `platform/errors.ts`, with no hand-built replies.
