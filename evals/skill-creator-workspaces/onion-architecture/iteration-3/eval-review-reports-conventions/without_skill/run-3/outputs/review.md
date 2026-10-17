# Architecture review: reports PR

Scope: the 7 files in CHANGED.txt (server only). The service/repository/adapter split is mostly sound. The problems are mainly in wiring and port placement.

## Problems

### 1. Routes build the object graph by hand and bypass the DI container (`server/src/modules/reports/routes.ts`)
`reportRoutes` does `new ReportService(new ReportRepository(app.container.db), app.container.exporter, app.container.github)`.
- The transport layer imports the concrete `ReportRepository` and knows how the service is assembled. Routes should only parse HTTP and call the service.
- The repository and service are not in the container, so tests cannot override them. They are rebuilt every time the plugin registers.
- Fix: register `reportRepository` and `reportService` (lazy getters) in `platform/container.ts`. The route then uses `app.container.reportService` and drops the `./repository.js` and `./service.js` constructor wiring.

### 2. The port lives inside the S3 adapter folder (`server/src/adapters/s3/types.ts`, imported by `modules/reports/service.ts` and `platform/container.ts`)
`ReportExporter` and `ExportRequest` are the application's port, but they sit under `adapters/s3/`.
- The application layer (`service.ts`) imports from `../../adapters/s3/types.js`. The dependency points from the core to infrastructure, and the port is named after one vendor.
- Swapping S3 for GCS or local disk would move or rename the port the service depends on.
- Fix: move `ReportExporter` and `ExportRequest` to a vendor-neutral inward location, such as `modules/reports/ports.ts` or the existing shared/domain ports. The S3 adapter then imports and implements the port. The service and container import the port, not `adapters/s3`.

### 3. Direct `process.env` reads and silent defaults in the container (`server/src/platform/container.ts`)
`process.env.REPORTS_BUCKET ?? ''` and `process.env.GITHUB_TOKEN ?? ''` are read inside getters.
- A missing bucket yields an exporter with an empty bucket that fails only at upload time. A missing token creates a broken GitHub client.
- Config is scattered through the composition root instead of a validated config object.
- Fix: read and validate env once through the project's config module (zod). Fail fast at boot for required values and pass a typed config into the adapter constructors.

### 4. Service owns export rendering and storage layout, and is not atomic (`server/src/modules/reports/service.ts`)
- The service hard-codes the object key (`reports/${id}.${format}`), the MIME mapping and the body encoding. Storage layout and content generation are mixed into the use case. The body is plain text declared as `application/pdf`, so a "pdf" export is a corrupt file.
- Fix: put content generation behind its own port or helper (a `ReportRenderer` per format). Let the exporter or a helper own the key and content-type mapping.
- `export()` uploads first, then writes the URL. If `setExportedUrl` fails or returns null, an orphaned object remains and the error is misreported as `report_not_found`. Fix: handle the ordering or failure explicitly. Treat the second null as an internal error, or make the export idempotent by using a deterministic key.

### 5. Persistence mapper returns the transport contract as the domain type (`server/src/modules/reports/repository.ts`, `server/src/vendor/shared/contracts/report.ts`)
The repository returns the `Report` zod contract (ISO date strings, `format` cast with `as ReportFormat`). The persistence layer is shaped by the wire format, and the `as` cast hides invalid DB values.
- Fix: define a domain `Report` type in the module. Map to the API DTO in the route or service. Validate the stored `format` with `ReportFormat.parse` instead of casting.
- This is minor if the project deliberately uses the shared contracts as domain types. In that case, drop the cast only.

### 6. Minor items
- `S3ReportExporter` hard-codes the URL `https://${bucket}.s3.amazonaws.com/...`. This is wrong for other regions and buckets with dots, and for private buckets (it returns a non-working link). Return a presigned URL or the key, or take the base URL from config.
- `ReportService.create` is a pure pass-through. This is fine, but note it adds no domain rules (for example, checking that the repo exists).
- `routes.ts` has no response or param schemas, and `CreateReportBody.parse` throws raw zod errors unless a global error handler maps them. Confirm that one does.

## What is fine
- Service depends on the `ReportRepository` and `ReportExporter` abstractions via the constructor.
- The S3 SDK is confined to `adapters/s3/exporter.ts`.
- The container supports overrides for tests.

## Priority
1. Port placement (#2) and container/route wiring (#1): must fix.
2. Config (#3) and the export flow (#4): should fix before merge.
3. #5 and #6: follow-ups.
