# Architecture review: billing PR (onion-architecture)

Scope: the 9 changed files plus the modules they call (`customers/repository.ts`, `notifications/*`, `platform/*`). I followed local imports one hop, as the skill's "Searching for Indirect Violations" procedure requires.

Dependency chains found:

```
billing/service.ts  -> lib/payments.ts           -> stripe (SDK)
billing/service.ts  -> billing/helpers.ts        -> drizzle-orm, db/client.js, db/schema/billing.js
billing/service.ts  -> billing/types.ts          -> db/schema/billing.js ($inferSelect)
billing/service.ts  -> customers/repository.ts   (another module's repository)
customers/routes.ts -> billing/repository.ts     (another module's repository)
billing/service.ts <-> customers/service.ts      (import cycle)
```

## Problems

### 1. [High] `billing/service.ts` uses the Stripe SDK through a wrapper (`lib/payments.ts`)
- Files: `server/src/modules/billing/service.ts:4,31`, `server/src/lib/payments.ts:1-3`
- Why: `lib/payments.ts` exports `new Stripe(...)`, so it is the SDK itself. Importing it from the application layer is the same violation as `import Stripe from 'stripe'`. The client is built at module load from `process.env`, so it cannot be swapped through `ContainerOverrides` and there is no mock. Unit tests would hit the real Stripe API. `Container` has no payments port. The Stripe call also does not wrap vendor errors in `ExternalServiceError`, so a Stripe failure surfaces as a raw 500.
- Fix: add a `PaymentsClient` port (for example `createInvoice(customerExternalId, description)`) to `@devdigest/shared/adapters.ts`. Implement it in `server/src/adapters/payments/stripe.ts`, which is the only file that imports `stripe`, and wrap SDK failures in `ExternalServiceError`. Add `MockPaymentsClient` to `adapters/mocks.ts`. Register an async `payments()` getter with an override in `platform/container.ts`. In the service use `const payments = await this.container.payments()`. Delete `lib/payments.ts`.

### 2. [High] `billing/helpers.ts` talks to the database directly (`service.ts -> helpers.ts -> db/client.js`)
- File: `server/src/modules/billing/helpers.ts:1-3,10-13`, reached from `service.ts:9,28`
- Why: a helper that is meant to hold pure transforms imports `drizzle-orm`, the global `db` from `db/client.js`, and `db/schema/billing.js`. The service therefore reaches persistence through a helper, skipping `repository.ts`. It also uses the global `db` instead of `container.db`, so test containers cannot override it. `count() + 1` is a race: two concurrent requests get the same invoice number.
- Fix: keep only the pure `formatAmount` in `helpers.ts`. Move the number generation into `InvoiceRepository` (for example `nextNumber()`) using `this.db`. Preferably generate it atomically, with a DB sequence or a unique constraint plus retry, or inside the insert transaction.

### 3. [Medium] Drizzle row type leaks through `types.ts` into the service signature
- Files: `server/src/modules/billing/types.ts:1-3`, `service.ts:11,39-41`, `repository.ts:5,25-28`
- Why: `InvoiceRow = typeof t.invoices.$inferSelect` is a Drizzle type under a friendlier name. `BillingService.getRow(): Promise<InvoiceRow | null>` exposes it as a public service signature, so callers depend on the DB column shape. `repository.ts` already has a mapped `get(): Invoice`, so `getRow` is redundant and is the only reason the leak exists.
- Fix: remove `getRow` from the service and the repository, and use `get()`, which returns the shared `Invoice`. If a raw row type is still needed, define it locally in `repository.ts` and do not export it. Make `types.ts` hold only pure types such as `InvoiceStatus`, with no schema import.

### 4. [High] `billing/service.ts` imports another module's repository
- File: `server/src/modules/billing/service.ts:5,25`
- Why: `new CustomerRepository(this.container.db).get(customerId)` bypasses `CustomerService`, so its rules (not-found handling, `assertActive`) are skipped. For example, an inactive customer can still be invoiced here.
- Fix: call `new CustomerService(this.container).get(customerId)`, or `assertActive`, which already throws `NotFoundError`/`ConflictError`. Then drop the manual null check.

### 5. [High] Import cycle between `billing/service.ts` and `customers/service.ts`
- Files: `billing/service.ts:6,44` and `customers/service.ts:4,26`
- Why: `BillingService.totalOutstanding -> CustomerService.assertActive`, and `CustomerService.canBeDeactivated -> BillingService.totalOutstanding`. The two modules depend on each other. Constructing one creates the other, which is a recursion risk and makes each hard to test or change alone.
- Fix: make the dependency one-way. Billing is higher level and may call customers, so `customers/service.ts` must not import `BillingService`. Move the "can be deactivated" decision into billing (for example `BillingService.canCustomerBeDeactivated`), or have the caller orchestrate it. Alternatively have `CustomerService` receive the outstanding amount as an argument.

### 6. [High] `customers/routes.ts` imports `billing/repository.ts` and skips the service layer
- File: `server/src/modules/customers/routes.ts:3,7,11-14`
- Why: the route builds `new InvoiceRepository(app.container.db)` and queries it directly. This is transport reaching into persistence, and into another module's persistence, so billing rules are bypassed. The handler also chains two calls (`service.get` and then the repository), which is orchestration that belongs in a service rather than a route.
- Fix: add `BillingService.listForCustomer(customerId)`, or a `CustomerService` method that delegates to `BillingService`. The route should call exactly one service method and not import any repository.

### 7. [Medium] No error wrapping or consistency around the Stripe call, and a non-atomic write order
- File: `billing/service.ts:29-31`
- Why: the invoice row is inserted first and Stripe is called afterwards. If Stripe fails, a local `open` invoice exists with no remote invoice. Nothing wraps the vendor failure (`ExternalServiceError`).
- Fix: do this in the new payments adapter and in the service. Create the remote invoice first, or do both inside a compensating or transactional step. Surface failures as `ExternalServiceError`.

### 8. [Low] Persistence has no port, and the repository has two overlapping read methods
- Files: `billing/repository.ts`, `billing/service.ts:17`
- Why: `new InvoiceRepository(container.db)` matches the repo's accepted gap, so it is not a violation. This module has non-trivial logic (numbering and totals), though, so consider an `IInvoiceRepository` interface so the service can be tested with a mock. This is a note, not a blocker.
- Fix: optional interface. Remove the duplicated `get`/`getRow` (see #3).

## Checked and fine (not violations)
- `billing/routes.ts`: parses with Zod, calls one service method each, no DB/SDK imports, and failure paths are thrown as `AppError`s from the service.
- `billing/constants.ts`: literals only.
- `billing/repository.ts`: Drizzle belongs here, and the public `get`, `listForCustomer` and `insert` return the shared `Invoice`.
- `customers/repository.ts`, `customers/service.ts` (aside from the cycle), `notifications/*`: correct shape. The service takes the `Container` and builds its own repository. The one-way `new NotificationService(this.container)` call from billing is the intended pattern.

## Suggested fix order
1. Add the payments port, adapter, mock and container wiring (#1, #7).
2. Move invoice numbering into the repository (#2).
3. Replace the cross-module repository usage with service calls (#4, #6).
4. Break the billing/customers cycle (#5).
5. Remove `InvoiceRow` and `getRow` (#3).
