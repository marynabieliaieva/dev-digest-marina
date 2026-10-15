# Architecture review: reports PR (Onion / dependency direction)

Scope: the 7 files in CHANGED.txt (server-only snapshot). Layers per the onion-architecture skill:
domain = shared/contracts, application = service.ts, ports = shared/adapters.ts, infrastructure = adapters/* + repository.ts, transport = routes.ts.

Clean (checked, no issue): `contracts/report.ts` (Zod only, no outward imports); `service.ts` imports no SDK, no drizzle, no db/client or db/schema, and returns the shared `Report` type, not a `$inferSelect`; `repository.ts` confines Drizzle to itself and maps rows to `Report` via `toReport`; `exporter.ts` is the only file importing `@aws-sdk/client-s3`.

## Problems

### 1. [High] `ReportExporter` port is defined inside the adapter folder, and the service imports from it
- File: `server/src/adapters/s3/types.ts`; consumed by `server/src/modules/reports/service.ts:2`, `server/src/platform/container.ts:4`.
- Why: A new external integration must have its port in `@devdigest/shared/adapters.ts`. Here the interface lives in `adapters/s3/` (infrastructure), so the application layer (`service.ts`) imports from the infrastructure layer, which is an inward-to-outward dependency. The port is also named and located by vendor (`s3`), so replacing S3 means touching the service's import path. Every other port (`GitHubClient`, `LLMProvider`, ...) is imported from `@devdigest/shared`.
- Fix: Move `ReportExporter` and `ExportRequest` to `server/src/vendor/shared/adapters.ts` (and copy to `client/src/vendor/shared` if that file is mirrored there). `service.ts`, `container.ts` and `exporter.ts` then import the type from `@devdigest/shared`. Delete `adapters/s3/types.ts`.

### 2. [High] `routes.ts` constructs the repository and wires the service by hand
- File: `server/src/modules/reports/routes.ts:3,7-11`
- Why: The transport layer may import only the module's `service.ts`. Importing `ReportRepository` and passing `app.container.db`, `app.container.exporter` and `app.container.github` into the service lets routes reach past the service into persistence and adapters, and it makes the route file the composition root. It also differs from the established convention (service builds its own repository from the container).
- Fix: Route does `const service = new ReportService(app.container)`. The service constructor takes the whole `Container`, builds `this.repo = new ReportRepository(container.db)` and reads `container.exporter` / `container.github` through the getters. Routes then import only `ReportService`.

### 3. [Medium] `ReportService` takes individual ports as constructor arguments instead of the `Container`
- File: `server/src/modules/reports/service.ts:6-11`
- Why: The convention (`ReviewService`, `RepoService`) is `constructor(container: Container)` and pulling ports off its getters. Injecting a concrete `ReportRepository` class plus separate ports is a different pattern, spreads wiring into the caller (see #2), and means each new dependency changes every construction site.
- Fix: Switch to `constructor(private readonly container: Container)`, instantiate the repository inside, and use `container.exporter` / `container.github`. Tests override via `ContainerOverrides`.

### 4. [Medium] New integration is incomplete: no mock for the exporter
- File: `server/src/adapters/mocks.ts` (absent from the PR; not in CHANGED.txt)
- Why: A new integration needs all four pieces: port in shared/adapters.ts, concrete adapter, mock in `adapters/mocks.ts`, registration in `container.ts`. Port location (#1) and mock are missing. Without a mock, service tests and e2e must either hit S3 or stub ad hoc; `ContainerOverrides.exporter` exists but has nothing standard to inject.
- Fix: Add a `MockReportExporter` (in-memory, returns a deterministic URL) to `adapters/mocks.ts` and use it in tests/dev wiring.

### 5. [Medium] Storage details leak into the application layer
- File: `server/src/modules/reports/service.ts:22-26`
- Why: The service builds the object key (`reports/<id>.<format>`) and the MIME type, i.e. S3/object-store concepts (keys, contentType, Uint8Array body). The port is therefore shaped around S3 (`key`, `contentType`) rather than a domain operation, and the returned `https://<bucket>.s3.amazonaws.com/...` URL format is baked into the adapter. Swapping to another store forces service changes.
- Fix: Define the port in domain terms, e.g. `exportReport({ reportId, format, title, content }): Promise<string>`, and let the S3 adapter derive key/content-type/URL. If the content-type mapping stays in the service, move it to `helpers.ts`/`constants.ts` as a pure function.

### 6. [Low] Container reads env directly and defaults secrets/config to empty strings
- File: `server/src/platform/container.ts:20,26`
- Why: `process.env.REPORTS_BUCKET ?? ''` produces an adapter with an empty bucket that only fails at first upload with an opaque AWS error. `GITHUB_TOKEN ?? ''` has the same shape. Config/secrets should come through the existing `SecretsProvider`/config path, not ad hoc `process.env` reads in the container.
- Fix: Read via the project's config/secrets provider and fail fast in the getter (throw a clear error) when the bucket is unset.

### 7. [Low] Repository has no interface (known gap, flag for a new module)
- File: `server/src/modules/reports/repository.ts`
- Why: Persistence is the one un-inverted layer; for a new module the skill asks that an interface be considered so the service can be tested against a mock. Not a violation on its own, only a prompt to decide consciously.
- Fix: Optional `IReportRepository` interface, or note the decision in the PR description.

### 8. [Info] Items to verify outside the snapshot
- `server/src/db/schema/reports.ts` and a generated migration are imported/needed by `repository.ts` but are not in CHANGED.txt. Confirm they exist and the migration was produced by `drizzle-kit generate`.
- `service.ts:21` calls `this.github.getRepositorySummary(...)`. Confirm that method exists on the `GitHubClient` port in shared/adapters.ts; if it is being added, the port, Octokit adapter and mock must all be updated in this PR.
- `contracts/report.ts` must be copied by hand to `client/src/vendor/shared` if the client uses it.

## Checklist result
1. service imports concrete SDK: pass. 2. routes reach past service: **fail (#2)**. 3. Drizzle types in service signatures: pass. 4. Business logic in routes: pass. 5. Four-part integration: **fail (#1, #4)**. 6. Domain imports outward: pass. 7. Repository interface considered: note (#7).
