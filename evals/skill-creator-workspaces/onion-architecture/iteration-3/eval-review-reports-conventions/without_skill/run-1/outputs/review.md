# Architecture review: reports PR

Scope: the 7 files in CHANGED.txt (server-only snapshot).

## Problems

### 1. routes.ts builds the persistence layer itself (layer violation / DI bypass)
File: `server/src/modules/reports/routes.ts` (lines 3, 7-11)
- The transport layer imports `ReportRepository` and instantiates it with `app.container.db`, then hand-wires `ReportService`. Routes now know about the DB handle and the repository class, so the HTTP layer depends on infrastructure and on the service's constructor shape.
- The service is rebuilt at plugin registration outside the container, so it cannot be overridden in tests (the container has `overrides` for exactly this) and wiring is duplicated per module.
- Fix: construct `ReportRepository` and `ReportService` in `platform/container.ts` (e.g. `container.reportService`), and have routes only call `app.container.reportService`. Routes should import only the shared contracts and the service type.

### 2. Application layer imports a port from an adapter folder
File: `server/src/modules/reports/service.ts` (line 2), `server/src/adapters/s3/types.ts`
- `ReportService` imports `ReportExporter` from `adapters/s3/types.js`. The interface is the port (owned by the application/domain side), but it lives inside the S3 adapter directory and is named by vendor path. The dependency arrow therefore points from the core inward-to-outward (module -> adapters/s3). Replacing S3 with another store means touching the service's imports.
- Fix: move `ReportExporter` and `ExportRequest` to a vendor-neutral location owned by the core (e.g. `modules/reports/ports.ts` or the shared contracts, like `GitHubClient` already is). `adapters/s3/exporter.ts` then imports and implements the port; the service never references `adapters/*`.

### 3. Port leaks storage/format concerns into business logic
File: `server/src/modules/reports/service.ts` (lines 22-26)
- The service decides object key layout (`reports/<id>.<format>`), MIME types and encodes the body to bytes. These are export/infrastructure details baked into the application layer, and the `pdf ? ... : text/csv` branch silently treats any new format as CSV. Also a "pdf" is produced by UTF-8 encoding plain text, which is not a valid PDF.
- Fix: make the port domain-level (`export(report, content): Promise<string>`) and let the adapter map key/content type/serialization; or centralize format metadata in a constants/helper map keyed by `ReportFormat`.

### 4. Adapter hard-codes the public URL format and is configured in the container via env
Files: `server/src/adapters/s3/exporter.ts` (line 20), `server/src/platform/container.ts` (lines 20, 26)
- The URL is assembled as `https://<bucket>.s3.amazonaws.com/<key>` ignoring region (wrong for non-us-east-1 buckets) and the key is not URL-encoded. Persisted `exportedUrl` will be wrong/unreachable and also assumes a public bucket.
- The container reads `process.env` directly with empty-string fallbacks (`GITHUB_TOKEN ?? ''`, `REPORTS_BUCKET ?? ''`), so missing config fails late at first S3 call instead of at startup. Config should come from the validated config object, not scattered `process.env` reads.
- Fix: build the URL from region (or return the object key / a presigned URL), encode the key, and inject validated config into the container.

### 5. Service depends on the GitHub client only to build file content
File: `server/src/modules/reports/service.ts` (lines 1, 21)
- `getRepositorySummary(report.repoId)` is called with the local report's `repoId` (an internal DB id) while the GitHub client expects a remote repository identity; cross-module data is crossing without mapping through the repos module. Also this couples reports to the GitHub integration for a trivial string.
- Fix: obtain the summary through the repos module's service (or pass the repo's owner/name), not the raw internal id.

### 6. Non-atomic export with orphaned uploads
File: `server/src/modules/reports/service.ts` (lines 22-30)
- The object is uploaded before the DB is updated; if `setExportedUrl` returns null or fails, the S3 object is orphaned and the report stays unexported. A retry silently overwrites. Also `get` + `setExportedUrl` is two round trips with a race.
- Fix: make the order/failure handling explicit (mark status, compensate/delete on failure) and drop the redundant second not-found check by having the repository throw or by treating it as an invariant.

### 7. Route-level gaps
File: `server/src/modules/reports/routes.ts`
- The body is parsed with `.parse` inline (throws a raw ZodError unless a global error handler maps it) and `:id` has no schema validation; there is no response schema, so the export response shape is not enforced by the contract.
- Fix: use Fastify schemas / the project's validation helper for params, body and response using the `Report` contract.

## Minor / notes
- `repository.ts` is correctly confined to drizzle + mapping to the shared `Report` type (good); `format` is cast with `as ReportFormat` rather than validated, so a bad DB value would pass through typed as valid.
- `CreateReportBody` accepts any `repoId` string with no check the repo exists (service `create` does no existence check).
- `ContainerOverrides` / lazy getters follow the existing pattern for GitHub; keep that pattern for the new service (see #1).
