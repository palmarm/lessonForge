# LessonForge Roadmap

## Planning approach

Work through milestones at a flexible pace.
Choose one concrete outcome for each session.
Carry unfinished tasks into the next session.

The timeline is an estimate, not a fixed deadline.
Reassess it after the manual workflow is demonstrated.

## Milestones

### 1. Foundation

- [x] Create the project directory and folder structure.
- [x] Install Node.js and npm inside Ubuntu using nvm.
- [x] Record the Node.js version in `.nvmrc`.
- [x] Connect VS Code to Ubuntu through WSL.
- [x] Initialize Git.
- [x] Create README and `.gitignore`.
- [x] Document the project specification and architecture.
- [ ] Commit the initial documentation.
- [ ] Create and connect the GitHub repository.
- [x] Scaffold Next.js and NestJS.
- [x] Verify both applications start locally.
- [x] Implement PostgreSQL Compose and Prisma 7 connectivity.
- [x] Verify local database health, authenticated connectivity, and Ctrl+C shutdown.
- [x] Verify incorrect-password startup, container-recreation persistence,
  real stalled-connection/query timeout behavior, and live SIGTERM shutdown.

Demonstration: both applications run locally, with a verified
backend database connection.

### 2. Manual lesson workflow

- [ ] Select the sample subject, grade, and resources.
- [ ] Design the database schema and initial migration.
- [ ] Create sample teacher and administrator accounts.
- [ ] Implement sign-in and backend permissions.
- [ ] Browse curriculum resources.
- [ ] Create, edit, and save lesson drafts.
- [ ] Validate lessons before submission.

Demonstration: a teacher signs in and saves a lesson,
with unauthorized edits rejected.

### 3. Review workflow

- [ ] Preserve immutable submitted revisions.
- [ ] Implement administrator review.
- [ ] Request changes with feedback.
- [ ] Revise and resubmit while retaining history.
- [ ] Approve lessons for the library.
- [ ] Copy approved lessons into new drafts.
- [ ] Verify conflicting edits and review decisions are handled safely.

Demonstration: complete the submission, feedback, resubmission, approval, and reuse workflow.

### 4. AI drafting

- [ ] Build the AI service boundary using sample responses.
- [ ] Select a provider after reviewing cost and requirements.
- [ ] Generate structured drafts from selected resources.
- [ ] Validate output and preserve source information.
- [ ] Handle failures without losing saved work.
- [ ] Add request limits and timeouts.

Demonstration: generate, edit, and submit a lesson draft.

### 5. Delivery

- [ ] Containerize the applications.
- [ ] Automate checks, tests, and builds with GitHub Actions.
- [ ] Choose hosting.
- [ ] Configure deployment and database migrations.
- [ ] Add health checks and useful logs.
- [ ] Verify the deployed workflow.

Demonstration: use the application through a hosted URL.

### 6. Portfolio

- [ ] Complete setup and deployment instructions.
- [ ] Explain architecture decisions and tradeoffs.
- [ ] Record a short demonstration.
- [ ] Document lessons learned and remaining limitations.


## Session notes

At the end of each session, record:
- What was completed.
- What was learned.
- Verification results.
- The next task.

### Application setup verification

- Next.js with Tailwind CSS displays the LessonForge heading on port 3000.
  The developer verified browser styling and a successful Turbopack production
  build, including TypeScript checking and static page generation.
- NestJS uses ESM and serves `LessonForge API` from `GET /` on port 3001.
  Optional shell `PORT` overrides are validated before startup; environment files
  are not loaded automatically.
- Backend lint, TypeScript checking, build, 15 unit tests, and 1 end-to-end test
  passed. The compiled API's default-port HTTP smoke check also passed.
- The sandbox initially blocked the end-to-end test's local port binding with
  `EPERM`; the test passed when rerun outside the sandbox. The API smoke check
  also ran outside the sandbox and stopped its process after verification.
- The repository scan found only the root `.git`, pruning `node_modules`.
- Next task: PostgreSQL and Prisma setup. The full foundation demonstration
  remains incomplete until a database connection is verified.

### Database foundation implementation

This records the implementation session; later verification is recorded below.

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

### Production shutdown investigation

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

### Database foundation verification

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
