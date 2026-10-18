# Architecture review: billing PR (onion-architecture)

Scope: the 9 files in CHANGED.txt, plus the unchanged files they pull in (`customers/repository.ts`, `notifications/*`, `platform/*`). I followed local imports one hop and checked cross-module reach and cycles.

Verdict: do not open yet. 7 problems, 5 of them blocking.

## Blocking

### 1. `modules/billing/service.ts` + `lib/payments.ts` - Stripe SDK reached through a wrapper, no port
- Chain: `service.ts -> lib/payments.ts -> stripe`. `lib/payments.ts` does `export const stripe = new Stripe(process.env.STRIPE_KEY ...)`, so importing it from a service is the same as importing the SDK (line 4, used at line 31: `stripe.invoices.create`).
- Why: the Application layer depends on a concrete vendor client. It cannot be swapped via `ContainerOverrides`, so tests would hit Stripe. The env read happens at import time. A Stripe failure escapes as a raw vendor exception instead of `ExternalServiceError`, and `platform/errors.ts` has no `ExternalServiceError` yet.
- Fix: add a `PaymentsProvider` port (for example `createInvoice({customerRef, description})`) in `@devdigest/shared/adapters.ts`. Implement it in `server/src/adapters/payments/` (the only file importing `stripe`, wrapping errors in `ExternalServiceError`). Add a mock in `adapters/mocks.ts`. Register it in `platform/container.ts`. The service then calls `this.container.payments.createInvoice(...)`. Delete `lib/payments.ts`.

### 2. `modules/billing/helpers.ts` (used by `service.ts`) - direct Drizzle and global db in a helper
- Chain: `service.ts -> helpers.ts -> drizzle-orm`, `db/client.js`, `db/schema/billing.js`. `nextInvoiceNumber()` runs `db.select({n: count()}).from(t.invoices)` (lines 1-3, 10-13).
- Why: persistence is hidden in a "pure transforms" file, so the service leaks Drizzle one hop away. It uses the module-global `db`, not `container.db`, so test overrides and transactions are bypassed. Counting rows to number invoices is also race-prone: two concurrent requests get the same number.
- Fix: keep `helpers.ts` pure (`formatAmount` only). Move numbering into `InvoiceRepository` (for example `nextNumber()`, ideally a DB sequence or a unique constraint with retry). The service calls `this.repo.nextNumber()`.

### 3. `modules/billing/types.ts`, `service.ts`, `repository.ts` - `$inferSelect` alias leaks into the service signature
- `types.ts` exports `InvoiceRow = typeof t.invoices.$inferSelect` (and imports `db/schema/billing.js`). `BillingService.getRow(): Promise<InvoiceRow | null>` (service.ts lines 11, 39-41) exposes a Drizzle row type from the Application layer. `InvoiceRepository.getRow` also returns it publicly.
- Why: this is the `$inferSelect` leak under a friendlier name. Callers outside the service become coupled to the DB schema.
- Fix: delete `getRow` from the service (and the repo, if nothing needs it), or return the shared `Invoice` (the repo's existing `get()` already does this). Keep `InvoiceRow` private to `repository.ts`. `InvoiceStatus` can stay or move to the shared contract.

### 4. `modules/billing/service.ts` line 25 - imports another module's repository
- `new CustomerRepository(this.container.db).get(customerId)` skips the customers module's rules and the active check.
- Why: cross-module reach into a repository bypasses `CustomerService`.
- Fix: use `new CustomerService(this.container).get(customerId)` (it already throws `NotFoundError`, so the manual null check goes away). Use `assertActive` if inactive customers must not be billed.

### 5. Import cycle: `billing/service.ts <-> customers/service.ts`
- `BillingService.totalOutstanding` -> `CustomerService.assertActive`, and `CustomerService.canBeDeactivated` -> `BillingService.totalOutstanding` (customers/service.ts line 4, 26). Adding fix 4 would make billing depend on customers even more.
- Why: a circular module dependency means neither module can be understood or tested alone, and it risks init-order bugs.
- Fix: customers is the lower module; billing may call customers, not the reverse. Remove `canBeDeactivated` from `CustomerService` and put the check in billing (for example `BillingService.canDeactivateCustomer`), or have the caller compose the two. Alternatively move the "outstanding" query into the customers module if it is really customer state.

### 6. `modules/customers/routes.ts` line 3, 7, 14 - route reaches into another module's repository
- `new InvoiceRepository(app.container.db)` and `invoices.listForCustomer(...)` directly in the handler.
- Why: Interface layer skipping `service.ts`, and into a different module's persistence.
- Fix: add `BillingService.listForCustomer(customerId)` (or put this endpoint in `billing/routes.ts`). The customers route should call a service only: `service.get` then `new BillingService(app.container).listForCustomer(...)`. Beware of reintroducing the cycle from #5; the cleanest option is to move `/customers/:id/invoices` into the billing routes.

## Non-blocking

### 7. `modules/billing/service.ts` `create` - orchestration ordering and error handling
- The invoice row is inserted before the Stripe call. If Stripe fails, a local invoice exists with no remote counterpart and no compensation. Also, `routes.ts` uses `CreateInvoiceBody.parse` with no `lineItemCount`/`MAX_LINE_ITEMS` bound; that rule lives in the service, which is fine, but the unparsed `ZodError` should be mapped to a `ValidationError` by the central handler.
- Fix: call the payments port first (or wrap both in a transaction/outbox) and let the adapter raise `ExternalServiceError`.

## Checked and fine
- `routes.ts` (billing): parses, calls one service method, no DB or SDK imports.
- `BillingService` taking the whole `Container`, building its own `InvoiceRepository`, and `new NotificationService(this.container)` (one-way call): intended shape.
- `InvoiceRepository` using Drizzle and mapping rows to the shared `Invoice` in `get`/`list`/`insert`: correct.
- Errors are `AppError` subclasses; no hand-built reply bodies.
- `constants.ts`: no issues.
