# Architecture review: reports PR (onion-architecture)

Scope: the 7 files in CHANGED.txt (server only). Checked against the five-layer
dependency rule and the 7-point enforcement checklist.

## Verdict: do not open yet. 5 problems to fix, 2 to confirm.

Clean: `service.ts` imports no SDK, drizzle or `db/*`. `routes.ts` imports no SDK or
drizzle. `repository.ts` keeps `ReportRow` local and maps to the shared `Report`
before returning. `report.ts` contract imports only zod. The S3 SDK is imported in
exactly one file (`adapters/s3/exporter.ts`).

## Problems

### 1. Port is defined in the adapter folder, not in `shared/adapters.ts`; service depends outward on it
- Files: `server/src/adapters/s3/types.ts`, `server/src/modules/reports/service.ts` (line 2), `server/src/platform/container.ts` (line 4)
- Why: `ReportExporter` is a port but lives under `adapters/s3/` (infrastructure). The
  application layer (`service.ts`) imports `../../adapters/s3/types.js`, so an inner layer
  points at an outer one, and the port's home is named after the vendor (`s3`). Checklist
  item 5 requires the port in `@devdigest/shared/adapters.ts`.
- Fix: move `ReportExporter` and `ExportRequest` to `server/src/vendor/shared/adapters.ts`
  (and export via `@devdigest/shared`). Use a vendor-neutral name/shape. `S3ReportExporter`
  keeps `implements ReportExporter` imported from shared; `service.ts` and `container.ts`
  import the type from `@devdigest/shared`. Delete `adapters/s3/types.ts`.

### 2. No mock in `server/src/adapters/mocks.ts`
- Files: `server/src/adapters/mocks.ts` (absent from the PR)
- Why: a new integration needs port + concrete + mock + container registration (all
  four). The mock is missing, so `ReportService.export` cannot be unit-tested without
  hand-rolled stubs, which is the point of the inversion.
- Fix: add `MockReportExporter implements ReportExporter` (records uploads, returns a
  fake URL) in `adapters/mocks.ts`.

### 3. `routes.ts` builds the repository and wires the service by hand (transport reaching past the service)
- File: `server/src/modules/reports/routes.ts` (lines 3, 7-11)
- Why: routes should only parse, call one service method, and map the result. It imports
  `ReportRepository` (infrastructure), reads `app.container.db` (raw db handle) and
  assembles the service from individual ports. This is the "routes reach into repository/
  raw db" smell (checklist item 2), and construction logic is duplicated per module.
- Fix: `const service = new ReportService(app.container);` in routes (matching
  `RepoService`/`ReviewService`). Remove the `ReportRepository` import from `routes.ts`.

### 4. Service takes individual ports/repo as constructor args instead of the `Container`
- File: `server/src/modules/reports/service.ts` (lines 6-11)
- Why: convention is `constructor(private container: Container)` with the service
  building its own repository (`new ReportRepository(container.db)`) and pulling ports
  from the container. Positional args make every new dependency a breaking constructor
  change and diverge from every existing module. It is also what forces problem 3.
- Fix: take `Container`; `this.repo = new ReportRepository(container.db)`; use
  `container.exporter` / `container.github` at call time.

### 5. Container getters and config handling diverge from the established pattern
- File: `server/src/platform/container.ts` (lines 18-28)
- Why: existing integrations use async getters (`container.github()/llm()`) that fetch
  credentials via `this.secrets.get(...)` and cache. Here getters are sync properties
  reading `process.env.GITHUB_TOKEN ?? ''`, `REPORTS_BUCKET ?? ''`, `AWS_REGION` directly.
  This bypasses the `SecretsProvider` port, and silently builds an S3 client with an
  empty bucket. The `github` getter shown also looks like a rewrite of existing wiring;
  confirm it did not replace the secrets-based one.
- Fix: make `exporter()` async, resolve bucket/region via `this.secrets`, fail fast on
  missing config, keep `overrides.exporter` first. Restore the original `github` getter
  if it was changed.

### 6. Contract not mirrored to the client (confirm)
- File: `server/src/vendor/shared/contracts/report.ts`
- Why: shared contracts are manually duplicated to `client/src/vendor/shared`. CHANGED.txt
  has no client copy, so server and client contracts will drift if the client uses
  `Report`/`CreateReportBody`. Also confirm `contracts/index` re-exports it so
  `@devdigest/shared` resolves (service/routes import from there).
- Fix: copy to `client/src/vendor/shared/contracts/report.ts` and export it, or state in
  the PR that the client does not consume it.

### 7. Small layering nit in `service.ts`
- File: `server/src/modules/reports/service.ts` (lines 22-26)
- Why: object-key format, content-type mapping and body encoding are literals and pure
  transforms inline in the orchestration method. Not a dependency violation, but the repo
  places these in `constants.ts` / `helpers.ts`.
- Fix: extract `reportKey()`, `contentTypeFor()` (and a `REPORT_CONTENT_TYPES` map) into
  `modules/reports/helpers.ts` / `constants.ts`.

## Unverifiable from the snapshot
- `GitHubClient.getRepositorySummary` and `db/schema/reports.ts` (+ migration) are not in
  the PR/snapshot; confirm the port method exists in `shared/adapters.ts` and that the
  schema and generated migration are included.
- `ReportRepository` has no interface (persistence is not inverted repo-wide). Acceptable
  for now; consider `IReportRepository` if its logic grows.
