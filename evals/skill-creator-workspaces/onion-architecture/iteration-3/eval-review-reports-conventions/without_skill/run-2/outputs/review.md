# Architecture review: reports PR

Scope: the 7 files in CHANGED.txt (server only). Dependency direction expected: routes -> service -> ports (interfaces) <- adapters; composition happens in the DI container.

## Problems

### 1. Application layer depends on an infrastructure folder (port lives inside the S3 adapter)
- File: `server/src/modules/reports/service.ts` (line 2), `server/src/adapters/s3/types.ts`, `server/src/platform/container.ts` (line 4)
- Why: `ReportExporter` / `ExportRequest` are the port, but they are defined in `adapters/s3/types.ts`. The service imports `../../adapters/s3/types.js`, so the application layer points at the infrastructure layer (inward dependency rule inverted), and the port is named and placed after one vendor (S3). Swapping S3 for GCS/local disk would mean the service imports from a "wrong" adapter folder.
- Fix: move the interface to a vendor-neutral location, e.g. `server/src/modules/reports/ports.ts` (or `platform/ports/report-exporter.ts`, or a contract in `@devdigest/shared` like `GitHubClient`). Service and container import the port from there; `adapters/s3/exporter.ts` imports it to `implements` it. Keep only S3-specific code under `adapters/s3/`.

### 2. Routes build the service and instantiate the repository (bypasses the DI container)
- File: `server/src/modules/reports/routes.ts` (lines 3, 7-11)
- Why: the transport layer imports the concrete `ReportRepository` and wires `new ReportService(new ReportRepository(app.container.db), ...)` itself. Routes now know about persistence and about how the service is assembled; tests cannot override the repository/service via `ContainerOverrides`, and the wiring is duplicated if another entry point needs the service. The exporter/github are taken from the container but the repository is not, which is inconsistent.
- Fix: register `reportRepository` and `reportService` (lazy getters like `github`/`exporter`) in `platform/container.ts`; routes only use `app.container.reportService`. Routes should not import `repository.ts`.

### 3. Business rule and vendor details mixed into the service (format -> content-type, object key, body building)
- File: `server/src/modules/reports/service.ts` (lines 22-26), `server/src/adapters/s3/exporter.ts` (line 20)
- Why: the service decides the S3-style object key (`reports/<id>.<format>`) and a MIME type with an ad hoc ternary (any non-pdf format silently becomes `text/csv`, so adding a format later is a silent bug). The "pdf" body is just UTF-8 text, so a `.pdf` file is not actually a PDF. Conversely the adapter hardcodes the public URL `https://<bucket>.s3.amazonaws.com/...` (ignores region, custom endpoints, presigning, private buckets), which is infrastructure knowledge leaking into a returned domain value that is then persisted.
- Fix: put format metadata (extension, content type) in one map keyed by `ReportFormat` (exhaustive, in the module's `constants.ts`/`helpers.ts`), and move report rendering into a pure helper/renderer. Let the adapter own key-to-URL construction (or return a storage reference, not a hardcoded public URL).

### 4. Container reads raw environment variables and silently defaults to empty config
- File: `server/src/platform/container.ts` (lines 20, 26)
- Why: `process.env.GITHUB_TOKEN ?? ''` and `process.env.REPORTS_BUCKET ?? ''` mean a misconfigured deployment starts fine and fails only at first request with an obscure AWS error (empty bucket). Direct `process.env` access in the composition root, scattered, is not validated and is hard to test.
- Fix: read validated config from a central config object (zod-parsed env), fail fast at boot when `REPORTS_BUCKET` is missing, and pass config values into the adapter constructors.

### 5. Export is not atomic / not idempotent (upload then DB update with no compensation)
- File: `server/src/modules/reports/service.ts` (lines 17-31)
- Why: the object is uploaded to S3 first, then the URL is saved. If `setExportedUrl` fails or returns null (report deleted concurrently), an orphaned object remains and the caller gets a 404 for a successful upload. Re-running export overwrites silently with no status tracking. The second `NotFoundError` after a successful upload is also misleading.
- Fix: decide the failure semantics explicitly: record an export status (pending/exported/failed) or make the key deterministic and treat the upload as idempotent; delete the object (or surface a distinct error) when the persistence step fails.

### 6. Service depends on a broad external client for a trivial need (smaller, module-scoped port preferred)
- File: `server/src/modules/reports/service.ts` (lines 1, 21)
- Why: the whole `GitHubClient` is injected only to call `getRepositorySummary(report.repoId)`; note it is passed `repoId`, an internal id, which presumably is not what GitHub APIs take (owner/name), so the service is likely leaking identifier concepts across the boundary. The service is then coupled to every method of that client and hard to fake.
- Fix: look up the repo (owner/name) via the repos module/repository, and depend on a narrow port such as `RepoSummaryProvider` if only the summary is needed. Verify the identifier passed is correct.

### 7. Minor: missing input validation on the export route and no error mapping at the transport edge
- File: `server/src/modules/reports/routes.ts` (lines 19-21)
- Why: `POST /reports/:id/export` takes `id` from params without a schema (the create route validates its body via the shared zod contract, this one does not); no response schema either. Also the shared `Report` contract lives in `vendor/shared` but only the body is parsed, so the response shape is not guaranteed by the transport layer.
- Fix: add a params schema (e.g. `ReportIdParams` in `vendor/shared/contracts/report.ts`) and parse/validate it; declare route response schemas consistent with the other modules.

## What is fine
- `repository.ts` is the only file touching Drizzle and maps rows to the shared `Report` type (rows do not leak).
- `service.ts` does not import drizzle/AWS SDK directly; it talks to injected abstractions.
- `S3ReportExporter` is the only file importing `@aws-sdk/client-s3`.
- Zod contracts in `vendor/shared/contracts/report.ts` are plain, with no server-only dependencies.

## Severity summary
- Must fix before opening the PR: #1 (port in adapter), #2 (routes wiring + repository import).
- Should fix: #3, #4, #5, #6.
- Nice to have: #7.
