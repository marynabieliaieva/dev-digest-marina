# Architecture review: invoices + email notification PR

Reviewed against the onion-architecture rules: dependencies point inward only; services use ports through the Container; repositories own Drizzle types; new integrations need port + adapter + mock + container wiring.

What is already right: the `EmailSender` port is in `shared/adapters.ts`; `sendgrid.ts` is the only file importing `@sendgrid/mail`; `repository.ts` maps rows to the shared `Invoice` type before returning; `routes.ts` parses with a shared contract and delegates to one service method per endpoint.

## Problems

### 1. `server/src/modules/invoices/service.ts` imports the DB schema and exposes a Drizzle type (must fix)
- Why: `import { invoices } from '../../db/schema/invoices.js'` and `create(values: typeof invoices.$inferInsert)` put a persistence type in the application layer's public signature. Only `repository.ts` may touch `db/schema/*`. The application layer now depends on column shapes, and `routes.ts` has to build a DB-shaped object.
- Fix: delete the schema import. Make `create` take a domain input, for example `CreateInvoiceBody` (or a type derived from it) from `@devdigest/shared`. Move the mapping to the DB insert shape (`new Date(dueDate)` and so on) into `repository.ts` or `helpers.ts`.

### 2. `server/src/modules/invoices/repository.ts` public `insert` takes `InvoiceInsert` (must fix)
- Why: the method returns the domain type, but its parameter is `typeof t.invoices.$inferInsert`. That is what forces the leak in item 1. The Drizzle type crosses the repository boundary inward.
- Fix: `insert(input: CreateInvoiceBody): Promise<Invoice>`. Build the insert values inside the repository (the `dueDate` string becomes a `Date` there). Keep `InvoiceRow` and `InvoiceInsert` private to the file.

### 3. `server/src/platform/container.ts` email adapter cannot be overridden (must fix)
- Why: `ContainerOverrides` only has `secrets`, so tests cannot inject a fake `EmailSender`. The getter calls `new SendgridEmailSender(...)` directly, so the port is not really inverted. Every `InvoiceService` test would hit SendGrid.
- Fix: add `email?: EmailSender` to `ContainerOverrides` and return it first in the getter, as the other ports do.

### 4. `server/src/platform/container.ts` bypasses `SecretsProvider` and hardcodes config (should fix)
- Why: the API key is read from `process.env.SENDGRID_API_KEY ?? ''`, although the container already exposes a `SecretsProvider`. An empty key silently builds a broken sender that fails at send time. The sender address `billing@example.com` is hardcoded in the container.
- Fix: use an async getter matching the repo's `container.github()` and `container.llm()` convention. Read the key with `await this.secrets.get('SENDGRID_API_KEY')`, throw a clear error if it is missing, and take the from address from config or a secret.

### 5. No mock for the new port: `server/src/adapters/mocks.ts` is not updated (must fix)
- Why: a new integration needs all four pieces: port, adapter, mock, container registration. The mock is missing, so tests have nothing to inject (this compounds item 3).
- Fix: add `MockEmailSender implements EmailSender`, recording sent messages in a `sent: EmailMessage[]` array. Use it through `ContainerOverrides` in the invoice service tests.

### 6. `server/src/modules/invoices/service.ts` email failure breaks the create flow (should fix)
- Why: `await this.container.email.send(...)` runs after the invoice is persisted. A SendGrid outage makes `create` throw, so the client gets a 500 for an invoice that was in fact created. A retry would then create a duplicate. A notification is a side effect and must not decide the outcome.
- Fix: make the send best-effort: `void sender.send(...).catch(err => log.warn(...))`, or move it into its own `InvoiceNotifier` helper or service called with `new X(this.container)`. If delivery is required, record it and retry from a queue instead of failing the request.

### 7. `client/src/vendor/shared/contracts/invoice.ts` is out of sync with the server copy (should fix)
- Why: the contract is duplicated by hand. The client copy lacks `dueDate` in both `Invoice` and `CreateInvoiceBody`. The server returns `dueDate`, and the client's `CreateInvoiceBody` will strip or reject it. The two copies must stay identical.
- Fix: copy the server file over the client file. Note that this file is not in CHANGED.txt, so it was either missed in the PR or changed outside it.

### 8. `server/src/modules/invoices/routes.ts` builds a persistence-shaped object and does unchecked conversion (minor)
- Why: the route hand-assembles the service input and calls `new Date(body.dueDate)`. This is mapping logic that follows from item 1. An invalid date string becomes an Invalid Date that fails later in the DB layer, and the contract only checks `z.string()`.
- Fix: once item 1 is fixed, pass `body` straight to `service.create(body)`. Tighten `dueDate` in the contract (`z.string().datetime()` or a date regex) so bad input fails validation with a 400.

### 9. `server/src/modules/invoices/service.ts` constructs the repository directly (note only)
- Why: `new InvoiceRepository(container.db)` is the known persistence gap, and it matches the existing modules.
- Fix: acceptable here, since the repository is simple. Consider an `IInvoiceRepository` interface if query logic grows.

## Summary
Blocking: items 1, 2, 3, 5. Should fix before merge: 4, 6, 7. Minor: 8, 9.
The core design is sound: port, adapter and mapping are in the right places. The problems are a Drizzle type leaking through service and repository, an email port that cannot be swapped in tests, and a notification that can fail the create flow.
