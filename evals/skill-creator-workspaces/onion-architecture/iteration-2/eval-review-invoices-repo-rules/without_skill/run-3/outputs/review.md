# Architecture review: invoices + email notification PR

Scope: the 7 files in `CHANGED.txt`, plus two neighbouring files in the snapshot that the PR affects (`client/src/vendor/shared/contracts/invoice.ts`, `server/src/adapters/mocks.ts`).

Verdict: do not merge as is. There are 2 blocking layering violations (1, 2), 1 blocking contract bug (3), and several smaller issues.

## Blocking

### 1. `server/src/modules/invoices/service.ts` imports the Drizzle schema (application layer depends on infrastructure)
- Problem: line 3 imports `invoices` from `../../db/schema/invoices.js`, and `create()` takes `typeof invoices.$inferInsert` as its input. The service's public API is now the DB table shape. Any column change (nullable, default, rename, snake_case mapping) leaks into the service and the routes. The service cannot be unit-tested without the schema. The repository is meant to be the only module that knows about the schema.
- Fix: define an application-level input type, for example `CreateInvoiceInput = { customerEmail; amountCents; currency; dueDate: Date }` (or reuse `CreateInvoiceBody` from `@devdigest/shared`). `InvoiceService.create` takes that. `InvoiceRepository.insert` accepts the same domain type and maps it to `$inferInsert` internally. Remove the `db/schema` import from the service.

### 2. `server/src/platform/container.ts` hard-wires the SendGrid adapter and bypasses the secrets port
- Problem:
  - The `email` getter does `new SendgridEmailSender(process.env.SENDGRID_API_KEY ?? '', 'billing@example.com')`. It reads `process.env` directly, although the container already exposes `SecretsProvider` for exactly this purpose.
  - A missing key silently becomes `''` and only fails at send time.
  - The sender address is hard-coded.
  - `ContainerOverrides` has no `email` override, so tests cannot inject a fake. Every test that creates an invoice would try to call SendGrid.
  - The getter is lazy and mutable (`_email ??=`), unlike `secrets`, which is built in the constructor.
- Fix:
  - Add `email?: EmailSender` to `ContainerOverrides`.
  - Add `MockEmailSender` to `server/src/adapters/mocks.ts`, next to `MockSecretsProvider`, which records sent messages.
  - Build the email sender in the constructor (`overrides.email ?? new SendgridEmailSender(...)`).
  - Resolve the key via `await secrets.get('SENDGRID_API_KEY')`, which means an async factory or lazy init. Fail fast if it is missing.
  - Take the from-address from config, not a literal.

### 3. Client and server `Invoice` contracts have drifted (`client/src/vendor/shared/contracts/invoice.ts`)
- Problem: the server contract (`server/src/vendor/shared/contracts/invoice.ts`) has `dueDate` in both `Invoice` and `CreateInvoiceBody`. The client copy has neither. The client will strip or reject `dueDate`, and `POST /invoices` from the client will fail validation with a 400 because `dueDate` is required. This file is also missing from `CHANGED.txt`, so the PR is incomplete.
- Fix: update the client copy to match the server, or generate both from a single source. Add a check that the two vendored contracts are identical so they cannot drift again.

## Should fix

### 4. Notification is coupled into the `create` transaction path
- Problem: `service.create` inserts the row and then awaits `email.send` in the same call. If SendGrid is down or slow, `POST /invoices` returns 500 even though the invoice was already saved. A client retry then creates a duplicate invoice. Email formatting (subject, body, `amountCents / 100`) is also business or presentation logic living inline in the service.
- Fix: treat the email as a side effect that cannot fail the request. Catch and log the error, or enqueue it (outbox or background job). Move message composition into a small helper or template function (`buildInvoiceEmail(invoice)`) with a currency-aware formatter, instead of dividing by 100 inline. This also helps with currencies that do not have 2 decimals.

### 5. Service locator and manual wiring (`service.ts`, `routes.ts`)
- Problem: `InvoiceService` receives the whole `Container` and builds its own `InvoiceRepository` in the constructor. `routes.ts` does `new InvoiceService(app.container)`. The service depends on everything in the container, and its dependencies are hidden. Tests must build a full `Container`.
- Fix: inject only what is needed, e.g. `new InvoiceService({ repo, email })`. Compose in the container or a module-level factory. Routes then only call the service.

### 6. Weak date validation and handling at the edge (`routes.ts`, `contracts/invoice.ts`)
- Problem: `dueDate: z.string()` accepts any string. `new Date(body.dueDate)` in the route then produces an `Invalid Date` for bad input, which blows up later in the repository or in `toISOString()` and becomes a 500. Parsing and conversion belongs to the validation layer, not the handler.
- Fix: use `z.string().datetime()` (or `z.coerce.date()` in a transform) in the contract. The route passes the already-validated value on. Return 400 on bad input. Optionally also validate `:id` as a uuid.

## Minor / notes

- `server/src/adapters/email/sendgrid.ts` is correctly placed behind the `EmailSender` port and imports the SDK only in the adapter. Two small points: it calls `sgMail.setApiKey` on a module-global singleton in the constructor (a second instance would override the first), and it sends no HTML, no error mapping and no retry. Wrap SDK errors into a domain error so callers do not depend on SendGrid error shapes.
- `repository.ts` returns the shared `Invoice` DTO from `toInvoice`, which is fine. Its `insert(values: InvoiceInsert)` leaks the Drizzle type (see 1), and `markPaid` is not idempotent: calling it twice overwrites `paidAt`. Add `isNull(paidAt)` to the where clause or check the state first.
- The PR imports `db/schema/invoices.js` but no schema file or migration is in `CHANGED.txt`. Confirm both are included, since migrations do not run on boot.
- No tests are in the change list (service with `MockEmailSender`, route 400/404 cases, contract parity).
