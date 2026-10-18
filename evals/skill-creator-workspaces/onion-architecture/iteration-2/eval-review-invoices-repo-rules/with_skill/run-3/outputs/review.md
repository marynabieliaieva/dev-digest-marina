# Architecture review: invoices + email notification PR

Reviewed against the onion-architecture rules (dependencies point inward only; a new integration needs a port, an adapter, a mock and container wiring; services take the whole `Container`; routes only parse, call one service method and map the result).

Verdict: **changes requested.** There are 3 blocking problems and 4 smaller ones. The `SendgridEmailSender` adapter and the `EmailSender` port are themselves correct.

## Blocking

### 1. `server/src/modules/invoices/service.ts` imports the DB schema and exposes a Drizzle type in its public signature
- **Problem:** The service does `import { invoices } from '../../db/schema/invoices.js'` and declares `create(values: typeof invoices.$inferInsert)`. The application layer now depends on the persistence schema. A `db/schema/*` import is the same violation as importing `drizzle-orm` directly, and a `$inferInsert` type in a service signature is a listed anti-pattern. Any column change now ripples into the service, the routes and every caller.
- **Fix:** Remove the schema import. Add a domain input type to the shared contracts, for example `CreateInvoice` (infer it from `CreateInvoiceBody`), and make the signature `create(input: CreateInvoice): Promise<Invoice>`. Do the mapping to the insert shape inside `repository.ts`.

### 2. `server/src/modules/invoices/repository.ts` takes `InvoiceInsert` as a public parameter
- **Problem:** `insert(values: InvoiceInsert)` leaks the raw Drizzle type across the repository boundary. This is why finding 1 happens. The return side is fine, because `toInvoice` maps rows to the shared `Invoice` type.
- **Fix:** Change it to `insert(input: CreateInvoice): Promise<Invoice>` and build the insert values inside the repository, for example converting the `dueDate` string to a `Date` there. Keep `InvoiceInsert` and `InvoiceRow` local to the file.

### 3. `server/src/platform/container.ts` wires the email integration in a way that cannot be swapped or tested
- **Problem:**
  - `email` is a sync getter that hard-codes `new SendgridEmailSender(...)`. There is no `email?: EmailSender` in `ContainerOverrides`, so tests cannot inject a fake and `InvoiceService.create` would hit SendGrid. By the repo's rule, if it cannot be replaced through `ContainerOverrides`, it is not inverted.
  - It reads `process.env.SENDGRID_API_KEY ?? ''` directly. It bypasses the `SecretsProvider` that the container already owns, and it silently builds a client with an empty key.
  - The sender address `billing@example.com` is hard-coded.
  - It does not follow the existing getter convention, which is an async getter that caches and pulls the secret from `this.secrets` (the `container.github()` / `container.llm()` shape).
- **Fix:**
  - Add `email?: EmailSender` to `ContainerOverrides`.
  - Make it `async email(): Promise<EmailSender>`: return the override if present, otherwise return the cached instance, otherwise call `await this.secrets.get('SENDGRID_API_KEY')`, throw if it is missing, and construct `SendgridEmailSender`.
  - Take the sender address from config or a secret.
  - Update the service to `const email = await this.container.email(); await email.send(...)`.

## Should fix

### 4. `server/src/adapters/mocks.ts` has no `MockEmailSender`
- **Problem:** A new integration needs all four pieces: port, adapter, mock and container registration. The port, the adapter and (partly) the registration exist, but the mock is missing. `mocks.ts` still only contains `MockSecretsProvider`.
- **Fix:** Add `MockEmailSender implements EmailSender` that records messages in `sent: EmailMessage[]`. Use it through `ContainerOverrides.email` in the service tests.

### 5. `server/src/modules/invoices/routes.ts` builds a persistence-shaped input and does not validate the date
- **Problem:** The route converts `dueDate` with `new Date(body.dueDate)` and passes an insert-shaped object to the service. Shaping data for the DB is not the transport layer's job. `dueDate: z.string()` accepts any string, so a bad value produces `Invalid Date` and a 500 deep in the repository. The `.parse` call also throws a raw ZodError instead of a mapped 400.
- **Fix:** Pass the validated `body` (the `CreateInvoice` type) straight to `service.create(body)`. Validate the date in the contract, for example `z.string().datetime()` or `z.coerce.date()`. Do the conversion in the repository or service. Map validation errors to 400 using the repo's error handling.

### 6. `server/src/modules/invoices/service.ts` sends the email inline, so an email failure fails an invoice that was already saved
- **Problem:** `create` inserts the invoice and then awaits `email.send`. If SendGrid is down, the caller gets a 500 even though the invoice exists. A retry then creates a duplicate. The notification is a side effect and must not decide whether the business operation succeeded.
- **Fix:** Treat the notification as best-effort, as the notifications example does: `void this.sendInvoiceEmail(invoice).catch(err => logger.warn(...))`. Alternatively put the call behind a small `InvoiceNotifier` service. If delivery must be guaranteed, use an outbox. Put the email body formatting in `helpers.ts`.

### 7. Client contract copy is out of sync: `client/src/vendor/shared/contracts/invoice.ts`
- **Problem:** The shared contracts are duplicated by hand to the client. The server version has `dueDate` in both `Invoice` and `CreateInvoiceBody`. The client copy lacks it in both. The client will drop `dueDate` from responses and will not send it, so every create fails server validation.
- **Fix:** Copy the server file to the client byte for byte. Also check that `invoice` is re-exported from both `index.ts` files (not part of this PR's file list).

## Notes (non-blocking)

- `InvoiceService` builds `new InvoiceRepository(container.db)`. This matches the existing modules, and the lack of a repository port is a known gap. The invoice logic is small, so it is fine for now. If the invoices module gains real query or business logic, consider an `IInvoiceRepository` interface.
- `SendgridEmailSender` calls `sgMail.setApiKey` on the SDK's global singleton in its constructor. Constructing a second instance with a different key would change the first. This is acceptable for the adapter, but prefer the SDK's `MailService` instance if multiple senders are ever needed.
- Layering that is correct and should stay: the `EmailSender` port in `shared/adapters.ts` has no I/O, only `sendgrid.ts` imports `@sendgrid/mail`, and `contracts/invoice.ts` imports only `zod`.
