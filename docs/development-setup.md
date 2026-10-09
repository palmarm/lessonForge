# LessonForge development setup

Use this guide to set up the current application scaffold and database foundation.
See the [verification guide](database-foundation-verification.md) for recorded
results and the [project README](../README.md) for purpose and scope.

## Prerequisites and dependencies

Have Ubuntu/WSL, VS Code with its WSL connection, nvm, and Docker with the Docker
Compose plugin available. Docker must be accessible from the Ubuntu/WSL shell.
Unless a section specifies an application directory, run commands from the
repository root.

Development takes place in Ubuntu through WSL, using VS Code.

Select the project's Node.js version:

    nvm use

The required version is recorded in `.nvmrc`.

Each application has its own npm manifest and lockfile. From the repository root,
install the locked dependencies (on a fresh checkout):

```bash
npm ci --prefix frontend
npm ci --prefix backend
```

These commands install dependencies into each application's `node_modules/`.
They do not initialize Git repositories. Backend startup requires PostgreSQL;
validation, client generation, unit tests, and ordinary HTTP tests do not.

## Environment files

PostgreSQL runs in Docker Compose; NestJS runs directly in Ubuntu/WSL. From the
repository root, create local configuration from the examples only if the target
files do not already exist:

```bash
cp -n .env.example .env
cp -n backend/.env.example backend/.env
```

These commands create ignored configuration files. Before first database startup,
edit root `.env` to replace each placeholder:

- Replace `YOUR_DATABASE_NAME` with `lessonforge_dev`.
- Replace `YOUR_DATABASE_USER` with `lessonforge`.
- Replace `YOUR_DATABASE_PASSWORD` with your own local password.

In `backend/.env`, the `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB`
strings inside `DATABASE_URL` are placeholders, not automatic interpolation.
Replace them with the matching username, password, and database from root `.env`.
Percent-encode the password for the URL: for example, `@` becomes `%40`. Keep the
original password in root `.env` and keep the URL host at `127.0.0.1:5433`.
The examples contain no usable secret.

Compose reads root `.env` for database initialization. Backend startup and Prisma
CLI explicitly load **backend/.env** using Node's built-in loader, independently
of the current directory. They do not read root `.env`. Existing shell variables
win over file values. Missing backend files are allowed when the shell supplies
configuration; other file-loading errors stop startup. Never put database
credentials in frontend configuration or commit local environment files.

`DATABASE_URL` is required for API startup. It must contain a PostgreSQL protocol,
host, valid port (if supplied), database, username, and password. URL query options
are limited to `sslmode=disable|require|verify-ca|verify-full`; host overrides and
fragments are rejected. `PORT` is optional and defaults to `3001`.

## Docker and PostgreSQL

Validate Compose without printing interpolated credentials, then start the
service and wait for health:

```bash
docker compose config --quiet
docker compose up -d --wait db
docker compose ps
```

The pinned image is `postgres:17.11-bookworm`; its port is published only on
`127.0.0.1:5433`, mapped to PostgreSQL's internal port `5432`. The health check
uses `pg_isready` inside the container on port `5432`; authenticated connectivity is
verified separately by NestJS using `SELECT 1 AS ok` before HTTP starts.

The first start initializes the empty named volume `lessonforge_postgres_data`
and creates the configured database and bootstrap user. This local user has
superuser privileges; production roles will be designed at deployment.
Subsequent starts reuse the volume. Changing root `.env` after initialization
does not rename an existing database or change its stored password. Restarting or
recreating the container, and ordinary `docker compose down`, preserve the volume.
Do not delete volumes or reset the database to resolve credential mismatches.
There are no initialization or account-seeding scripts. The initial domain
migration is tracked but is not applied automatically by Compose or API startup.

## Prisma generation

Prisma 7.10.0 uses `@prisma/adapter-pg` and its `pg` driver. The schema contains the
six entities in the [domain design](domain-schema.md) and supports raw queries.
Generation writes ignored TypeScript under
`backend/src/generated/prisma`, using ESM `.js` imports; Nest compiles it into
`dist/generated/prisma`. Build and development startup generate the client first.
Generation and schema validation work without database credentials or connectivity.
Generation does not apply the tracked migration. Do not use `db push` as a
substitute: custom checks and triggers are maintained in migration SQL.

From the repository root, validate the schema and generate the client:

```bash
npm run prisma:validate --prefix backend
npm run prisma:generate --prefix backend
```

These commands validate the schema and regenerate ignored client source. They
create no database tables and do not apply migrations.

## Initial migration and isolated constraint verification

The migration is `backend/prisma/migrations/20261008000000_initial_domain/migration.sql`.
It creates all six tables and indexes before adding FKs, including the circular
lesson/current-revision relationship. A lesson starts with a null current pointer;
insert its revision and set the pointer in one transaction. The SQL also contains
reviewed checks and history/lesson-identity triggers that Prisma cannot express.
See [domain verification](domain-schema-verification.md) for actual results and
the remaining NestJS responsibilities.

The initial SQL was generated without a database or shadow database. To reproduce
the generated portion from `backend/` in a checkout without real `.env` files:

```bash
./node_modules/.bin/prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script --output /tmp/lessonforge-generated-domain.sql --config prisma.config.ts
```

This writes SQL to a temporary file only; it does not apply it. The generated
portion excludes custom checks, triggers, and the reviewed transaction wrapper.
Do not overwrite the tracked migration with this output or edit an already-applied
migration. Future schema changes need new reviewed migrations.

`test:constraints` is a separate, mutating live command. It never reads `.env` or
uses `DATABASE_URL`. Its dedicated Prisma config requires
`CONSTRAINT_TEST_DATABASE_URL`, `LESSONFORGE_CONSTRAINT_TEST=disposable`, and exactly
`lessonforge_constraints@127.0.0.1:5434/lessonforge_constraints_test` with a password
and no query parameters. It checks actual database/user identity and refuses a
nonempty public schema before `migrate deploy`. It never resets, drops, truncates,
or clears a database. Repeat runs require a newly created disposable container.
The existing read-only `test:db` target and safety checks are unchanged.

From the repository root, create a separate test container using the already
available PostgreSQL image:

```bash
docker run --detach --rm --pull=never --name lessonforge-constraints-test \
  --publish 127.0.0.1:5434:5432 --tmpfs /var/lib/postgresql/data \
  --env POSTGRES_DB=lessonforge_constraints_test \
  --env POSTGRES_USER=lessonforge_constraints \
  --env POSTGRES_PASSWORD=constraint_fixture_only \
  --health-cmd 'pg_isready -U lessonforge_constraints -d lessonforge_constraints_test' \
  --health-interval 1s --health-timeout 3s --health-retries 30 \
  postgres:17.11-bookworm
docker inspect --format '{{.State.Health.Status}}' lessonforge-constraints-test
```

This container binds only localhost port 5434 and stores its cluster in temporary
memory-backed storage, with no development volume attached. The password shown
is a disposable local fixture, not an application credential. `--pull=never`
prevents implicit image download. Wait until the health command reports `healthy`;
repeat only the inspect command while it is starting. A name or port collision
is a failure to resolve, not a reason to stop another container.

Then generate/build and run the isolated tests:

```bash
npm run build --prefix backend
CONSTRAINT_TEST_DATABASE_URL='postgresql://lessonforge_constraints:constraint_fixture_only@127.0.0.1:5434/lessonforge_constraints_test' \
  LESSONFORGE_CONSTRAINT_TEST=disposable npm run test:constraints --prefix backend
```

Build regenerates the ignored client and compiled API without applying migrations.
The test command applies tracked migrations and inserts fixture rows only in the
disposable database, then checks PostgreSQL SQLSTATEs for invalid mutations.
Some deliberately incomplete fixture content proves database shape enforcement,
not full lesson validation. It also proves a later source INSERT is allowed:
immutable-row triggers do not enforce finalized source-set membership.

The suite also checks referenced-key updates using SQLSTATE `23503` and the exact
FK name, then verifies all stored rows and original references remain unchanged.
It reuses the real preflight gate to reject its populated disposable database and
a mismatched live role without running initialization or changing stored data.
The identity test uses `SET LOCAL ROLE pg_read_all_data` within one transaction
on the same guarded connection; the documented test-container user is a superuser
and may assume this built-in role. No additional role or database is created.

After verification, dispose of only the container created above:

```bash
docker stop lessonforge-constraints-test
```

Because it uses `--rm` and temporary storage, this removes its container and
disposable data. It does not affect Compose, `lessonforge_dev`, or its named volume.
Ordinary unit/HTTP tests and CI never run this procedure.

The developer applied `20261008000000_initial_domain` to `lessonforge_dev` on
2026-10-09 and confirmed Prisma migrate status reported “Database schema is up to
date!” Backend build and compiled startup succeeded, `GET /` returned HTTP 200
with body `LessonForge API`, and Ctrl+C returned promptly to the shell. See
[verification evidence](domain-schema-verification.md) for the developer run and
the historical agent checks, which did not access the development database.
Authentication, seeding, and workflow services remain pending.

Applying tracked migrations is still a separate manual step for a newly
initialized development database; Compose and API startup do not apply them.
Review the SQL and configured target first, then from the repository root run:

```bash
./backend/node_modules/.bin/prisma migrate deploy --config backend/prisma.config.ts
```

Unlike generation, this loads the normal backend configuration and changes the
configured database by creating domain tables, enums, constraints, and triggers.
It does not create sample accounts or resources. Do not run it during disposable
verification, substitute a reset, or point the isolated test at the development
database. The developer's completed application is separate from isolated
constraint verification.

## Application startup

Run the applications in separate terminals from the repository root:

```bash
npm run dev --prefix frontend
```

Next.js serves the Tailwind-styled LessonForge page at `http://localhost:3000`.

```bash
npm run start:dev --prefix backend
```

NestJS serves `GET /` at `http://localhost:3001`, returning `LessonForge API`.
Both development commands watch for source changes; stop them with Ctrl+C.

The backend defaults to port `3001`. Override it through the shell, for example:

```bash
PORT=3002 npm run start:dev --prefix backend
```

`PORT` must be a decimal integer from `1` to `65535`; invalid values stop startup.
The backend explicitly loads `backend/.env`, with shell variables taking precedence.
Complete the environment and database setup above before starting the API.

For compiled production startup, build the backend and run the emitted entrypoint
from the repository root:

```bash
npm run build --prefix backend
npm run start:prod --prefix backend
```

The build generates Prisma first and compiles the API into `backend/dist/`.
Production startup runs `dist/main.js` from the backend directory. Both development
and compiled startup verify authenticated database connectivity before listening.
Confirm `GET /` returns `LessonForge API` at `http://localhost:3001`.

## Checks

Run frontend verification from `frontend/`:

```bash
npm run lint
npm run typecheck
npm run build
```

Run backend verification from `backend/` (no database required):

```bash
npm run prisma:validate
npm run prisma:generate
npm run lint
./node_modules/.bin/tsc --noEmit
npm run build
npm test
npm run test:e2e
```

Lint checks source without auto-fixing files. Frontend `typecheck` generates Next.js
route types before running TypeScript, so it works before the first development
server or build. Type checks do not emit JavaScript.
Builds generate `.next/` for the frontend and `dist/` for the backend.
Backend tests run once: `npm test` runs unit tests, and `test:e2e` exercises the HTTP
endpoint. End-to-end tests require permission to bind a local port. The frontend
build's existing Google Fonts integration requires network access on an uncached build.

### Explicit live database check

The explicit live check makes only `SELECT 1` and closes its connections:

```bash
npm run test:db --prefix backend
```

It refuses every target except `127.0.0.1:5433/lessonforge_dev` with no URL query
parameters. It creates no tables and changes no data. Unit and ordinary HTTP tests
replace database access and never require PostgreSQL.

## Shutdown and deadlines

Stop the API with Ctrl+C (`SIGINT`) in its terminal. `SIGTERM` also invokes Nest
shutdown hooks. Shutdown awaits database cleanup and closes open HTTP connections.

The database pool allows five connections. Acquisition/connect waits are limited
to five seconds; driver query waits and PostgreSQL statement execution are each
limited to five seconds. Initial connectivity can take acquisition plus query
time, with a separate 12-second initialization deadline. Driver limits also bound
the underlying operations when this deadline expires. Initialization failures
disconnect the client, report a sanitized error, and stop startup. Ctrl+C (`SIGINT`),
`SIGTERM`, and explicit Nest shutdown close connections. Driver errors and
configuration values are not printed by startup.
The HTTP adapter closes open connections during shutdown so an unfinished HTTP
request cannot keep the API alive. In-flight HTTP requests can be interrupted;
database cleanup is still awaited.

## Troubleshooting

- If Docker cannot expose host port 5432, use the documented
  `127.0.0.1:5433:5432` mapping. Backend URLs use host port 5433; PostgreSQL and its
  readiness check use port 5432 inside the container.
- If startup reports a configuration error, check that all example placeholders
  were replaced in the ignored environment files, the URL password is
  percent-encoded, and `PORT` is a decimal integer from 1 to 65535. Shell variables
  take precedence over file values.
- If the server is unavailable, check `docker compose ps` and wait for database
  health before starting the API. Readiness alone does not verify credentials;
  `test:db` and API startup perform authenticated connectivity checks.
- If authentication fails, confirm the backend URL matches the database's
  initialized credentials. Changing root `.env` does not change a password or
  database already stored in the volume. Do not reset the database or delete
  volumes to resolve mismatches.
- If `test:db` rejects its target, use `127.0.0.1:5433/lessonforge_dev` with no URL
  query parameters. Its local-only restrictions are intentional.
- If `test:constraints` rejects its target or preflight, use the dedicated port,
  database/user, acknowledgement, and fresh disposable container above. Do not
  weaken its guard or reset an existing database. Local socket restrictions can
  block it; rerun where sockets are allowed rather than mocking enforcement.
- If generated Prisma imports are missing, run
  `npm run prisma:generate --prefix backend`; build and development startup also
  generate the client automatically.
- If the API port is occupied, use the documented shell `PORT` override before
  startup. If ordinary HTTP tests cannot bind a local port, run them in an
  environment that permits local listeners.
- If an old compiled API hangs after Ctrl+C with an unfinished HTTP request,
  rebuild before running `start:prod`. The current HTTP adapter tracks and closes
  those connections while still awaiting Prisma cleanup.
- An uncached frontend build needs network access for its existing Google Fonts
  integration. Database-free frontend checks do not change that requirement.

Startup failures report sanitized errors and exit with code 1. When checking
incorrect-password or unavailable-server behavior, keep credentials out of shell
history and logs, preserve database data, and restore any temporary local
configuration or service changes after the check. Recorded live checks are in the
[database-foundation verification guide](database-foundation-verification.md).
