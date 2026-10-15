# Architecture review: billing PR

Scope: the 9 files in CHANGED.txt, plus the files they import (helpers, types, lib, customers, notifications, platform), followed one hop at a time. 7 problems found (1-6 must fix, 7 should fix). The notes at the end cover what I checked and found fine.

## Blocking

### 1. `billing/service.ts` imports the Stripe wrapper `lib/payments.ts` (SDK in the application layer)
- Chain: `modules/billing/service.ts` -> `lib/payments.ts` -> `stripe` (`export const stripe = new Stripe(...)`).
- Why: a local module that exports a configured SDK client is the vendor itself. This is the same violation as `import Stripe from 'stripe'` in a service. There is no port, no mock, and no container registration, so tests can't swap it through `ContainerOverrides`. `service.create` makes a real Stripe call and can't be unit-tested without the network. The client is also built at import time from `process.env`.
- Fix:
  - Add a `PaymentsProvider` port (e.g. `createInvoice({ customerId, description })`) to `@devdigest/shared/adapters.ts`.
  - Put the Stripe implementation in `server/src/adapters/payments/`, with the SDK imported only there.
  - Add a mock to `adapters/mocks.ts` and register it in `platform/container.ts`.
  - The service then calls `this.container.payments.createInvoice(...)`. Delete `lib/payments.ts`.
  - The adapter should wrap Stripe failures in `ExternalServiceError`. That class does not exist yet in `platform/errors.ts` and needs adding.

### 2. `billing/service.ts` -> `billing/helpers.ts` -> `db/client.js`, `db/schema/billing.js`, `drizzle-orm` (hidden DB leak)
- Why: `helpers.ts` should hold pure transforms. `nextInvoiceNumber()` runs a Drizzle `count()` query through the global `db` import. A service that imports this helper reaches the database without going through `repository.ts`.
  - It bypasses the container's `db`, so it is not injectable or mockable.
  - `count()+1` is race-prone: two concurrent requests can get the same invoice number.
- Fix:
  - Move number generation into `InvoiceRepository` (e.g. `nextNumber()`), ideally a DB sequence or a unique constraint with retry, and have the service call `this.repo`.
  - Keep only pure `formatAmount` in `helpers.ts`, with no `db`, `drizzle-orm` or schema imports.

### 3. `billing/types.ts` and `service.getRow()` leak a Drizzle `$inferSelect` type
- Chain: `types.ts` (`InvoiceRow = typeof t.invoices.$inferSelect`) -> `service.ts` (`getRow(): Promise<InvoiceRow | null>`) -> `repository.getRow`.
- Why: the alias is a Drizzle type under a friendlier name, and it appears in the public signature of a service method. The raw persistence shape escapes the service. `types.ts` also imports `db/schema` from outside the repository.
- Fix:
  - Return the shared `Invoice` domain type from the service; `repo.get()` already does this.
  - Drop `service.getRow` and `repository.getRow` if nothing needs them.
  - Keep `InvoiceRow` private to `repository.ts` (not exported, or defined in the repository file).
  - `InvoiceStatus` can stay in `types.ts`, or better move it to the shared contracts.

### 4. `billing/service.ts` imports another module's repository (`customers/repository.js`)
- Code: `new CustomerRepository(this.container.db).get(customerId)`.
- Why: it skips the customers module's business rules (e.g. `assertActive`) and couples billing to customers' persistence. Inactive customers can currently be invoiced. `create` doesn't call `assertActive`, though `totalOutstanding` does.
- Fix: call `new CustomerService(this.container).get(customerId)`, or `assertActive`, via the customers service instead.

### 5. `customers/routes.ts` imports `billing/repository.js` (route reaches into another module's persistence)
- Code: `const invoices = new InvoiceRepository(app.container.db); ... invoices.listForCustomer(...)`.
- Why: a route must call exactly one method on its own module's service. This one skips the service layer and the billing module's rules. It also does two steps (`service.get` and then a repository read), which is orchestration in the transport layer.
- Fix:
  - Add `BillingService.listInvoicesForCustomer(customerId)`.
  - Add a `CustomerService` method that validates the customer and calls it via `new BillingService(this.container)`. Have the route call only that.
  - Alternatively, move the `/customers/:id/invoices` route into the billing module.

### 6. Import cycle `billing/service.ts` <-> `customers/service.ts`
- Chain:
  - `BillingService.totalOutstanding` -> `new CustomerService(...)` -> `assertActive`
  - `CustomerService.canBeDeactivated` -> `new BillingService(...)` -> `totalOutstanding`
- Why: each service imports the other, so a recursive call is possible and neither module can be loaded or tested alone. The dependency direction is not one-way.
- Fix: make one side the lower one. Billing already depends on customers (it needs a customer to invoice), so keep `billing -> customers`. Remove `canBeDeactivated` from `CustomerService` and put the "has outstanding invoices" check in the billing service (e.g. `BillingService.canDeactivateCustomer`), or have the caller orchestrate it. A shared lower-level piece would also work.

## Should fix

### 7. External call ordering and error handling in `billing/service.ts` `create`
- Why:
  - The invoice row is inserted and then Stripe is called. If Stripe fails, the DB keeps an `open` invoice with no Stripe counterpart and the raw vendor exception escapes (a 500 instead of a mapped 502).
  - `lineItemCount` is validated in the service, which is good, but `ZodError` from `CreateInvoiceBody.parse` in the route is not an `AppError`. Confirm the error handler maps it, or use `safeParse` and throw `ValidationError`.
- Fix: do the payment call first, or run both in a transaction with compensation. Have the adapter throw `ExternalServiceError`.

### Note: persistence not inverted
`InvoiceRepository` has no interface, which is the repo's known gap. Given the non-trivial logic (numbering, aggregation), consider an `IInvoiceRepository` so the service can be tested against a mock.

## Checked and fine
- `billing/routes.ts`: parses, calls one service method, maps the result. It imports no db or SDK.
- `billing/repository.ts`: Drizzle is allowed here, and it maps rows to the shared `Invoice` for `get`, `listForCustomer` and `insert` (only `getRow` leaks, see 3).
- `notifications/*`: clean, and the one-way `new NotificationService(this.container)` call is the intended shape.
- `constants.ts`: pure literals.
- Constructing `new InvoiceRepository(container.db)` in the service is the intended shape.
