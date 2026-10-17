# Architecture review: reports PR (onion-architecture)

Scope: the 7 files in CHANGED.txt. Checked against the Dependency Rule (imports point inward only) and the repo's module conventions.

Clean: `contracts/report.ts` (zod only, no outward imports), `s3/exporter.ts` (the only file importing `@aws-sdk/client-s3`), `service.ts` imports no SDK/drizzle/db, `repository.ts` maps `$inferSelect` to the shared `Report` before returning, `routes.ts` has no business logic.

## Problems

### 1. The `ReportExporter` port is in the wrong place (inverted dependency)
- Files: `server/src/adapters/s3/types.ts`, `server/src/modules/reports/service.ts` (line 2), `server/src/platform/container.ts` (line 4)
- Why: the port is defined inside the infrastructure folder (`adapters/s3/`) and named after the vendor. `service.ts` (Application layer) imports from `adapters/...`, which is an outer layer, so the dependency points outward. Ports must live in `@devdigest/shared/adapters.ts` (domain-side), like `GitHubClient`/`LLMProvider`. The `s3` path also leaks the implementation choice into the service.
- Fix: move `ReportExporter` and `ExportRequest` into `server/src/vendor/shared/adapters.ts`. Make `service.ts`, `container.ts` and `s3/exporter.ts` import them from `@devdigest/shared`. Delete `adapters/s3/types.ts`.

### 2. The new integration is missing its mock
- Files: `server/src/adapters/mocks.ts` (not in the PR), `server/src/platform/container.ts`
- Why: a new external integration needs all four pieces: port, concrete adapter, mock, and container registration. A mock is missing, so the service cannot be unit-tested without S3 or ad hoc stubs. `ContainerOverrides.exporter` exists but nothing supplies a default fake.
- Fix: add a `MockReportExporter` (in-memory, returns a deterministic URL) to `adapters/mocks.ts` and use it in tests and dev wiring.

### 3. `routes.ts` reaches past the service and builds its dependencies
- File: `server/src/modules/reports/routes.ts` (lines 3, 7-11)
- Why: the transport layer imports `ReportRepository` (infrastructure) and instantiates it with `app.container.db`. It also wires the exporter and github port into the service. Routes should only import their own `service.ts`, parse the request, call one service method and map the result. This also bypasses the container, so repository construction is not centralized.
- Fix: `const service = new ReportService(app.container)` and drop the `ReportRepository` import from routes.

### 4. `ReportService` does not take the `Container`
- File: `server/src/modules/reports/service.ts` (constructor, lines 7-11)
- Why: the convention (`ReviewService`, `RepoService`) is that the service takes the whole `Container` and pulls ports from its getters. Here it takes three separate constructor arguments, including a concrete `ReportRepository` type, which is the cause of problem 3.
- Fix: `constructor(private readonly container: Container) { this.repo = new ReportRepository(container.db); }` and use `this.container.exporter` / `this.container.github`.

### 5. Possible missing port method: `getRepositorySummary`
- File: `server/src/modules/reports/service.ts` (line 21)
- Why: the PR does not touch `shared/adapters.ts`, so `GitHubClient.getRepositorySummary` must already exist there. I cannot verify that from this snapshot. If it does not exist, the port was extended informally or this does not compile.
- Fix: confirm the method is on the `GitHubClient` port and implemented in the Octokit adapter and the mock. If not, add it to all three.

### 6. Persistence has no interface (known gap, flag only)
- File: `server/src/modules/reports/repository.ts`
- Why: services instantiate repositories directly, so the service cannot be tested against a fake. Acceptable for existing modules, but a new module should consider it. Minor: `row.format as ReportFormat` is an unchecked cast of a DB string.
- Fix (optional): introduce an `IReportRepository` interface and parse the format with `ReportFormat.parse(row.format)` in `toReport`.

### 7. Container config and shared-contract copy (minor)
- Files: `server/src/platform/container.ts` (lines 26), `server/src/vendor/shared/contracts/report.ts`
- Why: `REPORTS_BUCKET` defaults to `''`, so a misconfigured deploy only fails at upload time inside S3. The new contract must also be copied by hand to `client/src/vendor/shared`, which is not in this PR.
- Fix: fail fast on a missing bucket when the exporter is first built, and add the manual client copy of `report.ts`.

## Summary
Blocking: 1, 3, 4 (layering and convention violations). Should fix before merge: 2, 5. Optional: 6, 7.
