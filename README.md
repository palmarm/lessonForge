# LessonForge

An AI-assisted lesson-planning application built as a portfolio and learning project.

## Purpose

Help teachers create lesson plans from sample curriculum resources,
revise their drafts, and submit them for administrator review.

The project develops practical skills in full-stack TypeScript, database design, AI integration, testing, and DevOps.

## MVP scope

The first version supports one fictional school, one subject,
and one grade level, using sample learning materials.

- Sign in as a teacher or administrator.
- Browse administrator-managed curriculum resources.
- Create, edit, and save lesson drafts.
- Submit a lesson revision for review.
- Approve a submission or request changes with feedback.
- Browse approved lessons and copy one into a new draft.
- Generate editable AI drafts from selected resources.
- Preserve submitted revisions and review decisions.

Teachers review AI-generated content before submission.
AI cannot approve or publish lessons.

Publication means inclusion in the application's approved lesson library.
Sample materials do not imply official curriculum alignment.

## Technology stack

- Frontend: Next.js and TypeScript
- Styling: Tailwind CSS v4 via its PostCSS plugin
- Backend: NestJS and TypeScript
- Database: PostgreSQL
- Database access and migrations: Prisma ORM
- Local infrastructure: Docker Compose
- CI/CD: GitHub Actions
- AI provider and hosting: to be selected later

NestJS owns business rules, authorization, and database access.
Next.js provides the user interface and communicates with the backend.
Prisma runs within the backend.

## Repository structure

- frontend/ — Next.js application
- backend/ — NestJS application and Prisma
- docs/ — specification, architecture, and roadmap

## Development environment

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
See the database setup below before starting the API.

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

## Local database setup

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
There are no initialization scripts, business tables, or migrations in this task.

Prisma 7.10.0 uses `@prisma/adapter-pg` and its `pg` driver. The model-free schema
supports raw queries. Generation writes ignored TypeScript under
`backend/src/generated/prisma`, using ESM `.js` imports; Nest compiles it into
`dist/generated/prisma`. Build and development startup generate the client first.
Generation and schema validation work without database credentials or connectivity.
No migration or schema-push command is part of setup yet.

The database pool allows five connections. Acquisition/connect waits are limited
to five seconds; driver query waits and PostgreSQL statement execution are each
limited to five seconds. Initial connectivity can take acquisition plus query
time, with a separate 12-second initialization deadline. Driver limits also bound
the underlying operations when this deadline expires. Initialization failures
disconnect the client, report a sanitized error, and stop startup. Ctrl+C (`SIGINT`), `SIGTERM`, and explicit Nest shutdown close
connections. Driver errors and configuration values are not printed by startup.
The HTTP adapter closes open connections during shutdown so an unfinished HTTP
request cannot keep the API alive. In-flight HTTP requests can be interrupted;
database cleanup is still awaited.

The explicit live check makes only `SELECT 1` and closes its connections:

```bash
npm run test:db --prefix backend
```

It refuses every target except `127.0.0.1:5433/lessonforge_dev` with no URL query
parameters. It creates no tables and changes no data. Unit and ordinary HTTP tests
replace database access and never require PostgreSQL.

After the live check passes, run the API in development or build it and run
`npm run start:prod --prefix backend`. Confirm `GET /` returns `LessonForge API`,
then stop it to check shutdown. Also verify startup fails safely when PostgreSQL
is stopped or credentials are incorrect. The developer verified live connectivity,
development and compiled startup, Ctrl+C shutdown, and sanitized exit code 1 when
PostgreSQL was stopped; PostgreSQL was then restored to healthy. The developer also
verified incorrect-password startup (sanitized error and exit code 1), persistence
across container recreation (matching cluster identifier and passing `test:db`
afterward), real stalled-connection/query timeouts, and live SIGTERM shutdown.

## Build sequence

1. Project setup and documentation.
2. Manual lesson creation and saving.
3. Submission, revisions, and administrator review.
4. AI drafting and validation.
5. Automated checks, containerization, and deployment.
6. Portfolio documentation and demonstration.

## Deferred features

Semantic search, document uploads, student accounts, multiple schools,
and PDF export are outside the initial MVP.


## Current status

Next.js with Tailwind CSS and the NestJS ESM API are scaffolded.
The developer verified frontend styling on port 3000 and its Turbopack build.
PostgreSQL Compose configuration and Prisma 7 connectivity are implemented.
The developer verified healthy PostgreSQL at `127.0.0.1:5433`, one passing live
`test:db` test, development API responses, and backend build and compiled production
API responses. Updated production startup returned promptly after Ctrl+C.
With PostgreSQL stopped, compiled startup emitted a sanitized error and exited 1;
PostgreSQL was then restored to healthy.

Previously reported agent checks passed: 62 unit tests, 7 HTTP tests with substituted
database access, lint, TypeScript checking, build, formatting, and whitespace checks.
HTTP tests required execution outside the sandbox to bind local ports.
The developer also verified incorrect-password startup, container-recreation
persistence, real stalled-connection/query timeouts, and live SIGTERM shutdown.
See the
[database-foundation verification note](docs/roadmap.md#database-foundation-verification)
for the evidence record. Domain schema design, authentication, AI, and CI remain
later tasks.
