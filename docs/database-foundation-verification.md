# LessonForge database-foundation verification

This records previously completed checks, distinguishing developer-run live checks
from agent-run checks. Reorganizing this documentation does not rerun those checks.
Use the [development setup guide](development-setup.md) for commands and the
[roadmap](roadmap.md) for subsequent work.

## Current verification

- Developer-run checks: PostgreSQL healthy at `127.0.0.1:5433`; explicit live
  `test:db` passed (1 test); development API responded; backend build and compiled
  production API passed. Updated production startup returned promptly after
  Ctrl+C. With PostgreSQL stopped, compiled startup emitted a sanitized error
  and exited 1; PostgreSQL was then restored to healthy.
- Previously reported agent-run checks: 62 unit tests and 7 HTTP tests passed,
  along with lint, TypeScript checking, build, formatting, and whitespace checks.
  Ordinary tests substitute database access; HTTP tests required execution
  outside the sandbox to bind local ports.
- Additional developer-run checks: incorrect-password startup returned a sanitized
  error and exit code 1. PostgreSQL's cluster identifier matched before and after
  container recreation; `test:db` passed afterward. Live SIGTERM shutdown and real
  stalled-connection/query timeout behavior were verified. These checks close the
  four previously recorded database-foundation evidence gaps.

Domain schema design, authentication, lesson workflows, AI, and CI remain later
milestones; the database-foundation results do not establish completion of them.

## Historical records

The following records preserve the implementation and shutdown investigation
sessions. Earlier pending items describe their status at the time and were closed
by the developer checks recorded above. Earlier test counts are historical;
62 unit tests and 7 HTTP tests are the latest reported agent results.

## Database foundation implementation

This records the implementation session; current verification is recorded above.

- Added local PostgreSQL 17.11 Compose configuration, required ignored local
  credentials, a named volume, localhost port binding, and a readiness check.
- Added Prisma 7.10.0 generation from a schema with no models, explicit backend
  environment loading, validation, and a dedicated connection lifecycle service.
- Startup checks `SELECT 1` before HTTP. Driver limits are five seconds and the
  initialization deadline is twelve seconds. Failure and shutdown paths close
  connections and report sanitized errors.
- Ordinary tests substitute database access. `test:db` is separate, restricted to
  `127.0.0.1:5433/lessonforge_dev`, and executes no writes.
- Prisma validation and generation passed without a database URL or local `.env`.
  Compose configuration validation passed with temporary nonsecret shell values;
  no Docker service was started. Compose also rejected missing required
  configuration as expected. Generated-file and local-environment ignore checks
  passed.
- Backend lint (without warnings), TypeScript checking, build, and all 60 unit
  tests passed. The ordinary HTTP test passed outside the sandbox after its
  temporary listener was initially blocked with `EPERM`. Vitest reports an
  existing Vite path-plugin advisory; it does not fail the checks.
- Compiled ESM client imports passed. Environment-path resolution passed from
  the project root and from `/tmp`. Direct compiled startup checks for invalid `PORT`
  and missing `DATABASE_URL` exited with code 1 and safe messages before database
  access. A subprocess assertion harness was blocked by sandbox `EPERM`; direct
  command checks verified those failures instead.
- At the end of that session, live database readiness, authenticated connectivity,
  persistence, incorrect credentials/unavailable-server behavior, and actual signal
  shutdown were unverified. No packages were installed by the agent, real `.env`
  files created, migrations run, or database data/volumes changed.
- Next task at that time: fill local configuration and perform the documented live
  checks; then design the domain schema before creating the first migration.

## Production shutdown investigation

- Reproduced shutdown waiting on HTTP connections with no request or incomplete
  headers. Nest ignores repeated signals while that shutdown is pending.
- Enabled the HTTP adapter's socket tracking and closure at shutdown. Prisma
  pool cleanup remains awaited; no application `process.exit()` was added.
- Added regression coverage for explicit close, SIGINT, SIGTERM, repeated
  signals, signal-listener removal, and awaiting cleanup after startup failure.
- Verified 62 unit tests and 7 HTTP tests, TypeScript checking, and Nest build.
  HTTP tests required execution outside the sandbox to bind local test ports.
- A compiled production probe through npm, with PostgreSQL connected and an
  unfinished HTTP request, completed pool and HTTP cleanup on SIGINT and exited
  with status 130. The probe made only the existing `SELECT 1` startup query.
