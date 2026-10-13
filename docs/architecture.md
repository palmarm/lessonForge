# LessonForge Architecture

## Status

Application scaffolding is implemented: Next.js with Tailwind CSS and a minimal
NestJS ESM API. PostgreSQL Compose and Prisma 7 connectivity are implemented.
The developer verified local database health, live authenticated connectivity,
development and compiled API responses, prompt Ctrl+C shutdown, and sanitized
startup failure with exit code 1 when PostgreSQL was stopped. PostgreSQL was
restored to healthy. The developer also verified incorrect-password startup,
container-recreation persistence, real stalled-connection/query timeouts, and
live SIGTERM shutdown.
The [domain schema design](domain-schema.md) records the confirmed Grade 4
Mathematics context and validation policies. The six domain models and initial
migration SQL are implemented and verified in a disposable database. On
2026-10-09, the developer confirmed successful migration application to
`lessonforge_dev` and up-to-date migration status, backend build and compiled
startup, an HTTP 200 `GET /` response with body `LessonForge API`, and prompt
Ctrl+C shutdown. Backend authentication is now implemented separately; the Session
migration still needs developer application. Account provisioning, frontend
sign-in, seeding, and workflow services remain pending; see
[domain verification](domain-schema-verification.md).

## 1. Technology choices

| Area | Choice |
|---|---|
| Frontend | Next.js with TypeScript |
| Styling | Tailwind CSS v4 via `@tailwindcss/postcss` |
| Backend | NestJS with TypeScript |
| Database | PostgreSQL |
| Database access and migrations | Prisma ORM |
| Package manager | npm |
| Local infrastructure | Docker Compose |
| Automation | GitHub Actions |
| AI provider | Selected at the AI milestone |
| Hosting | Selected at the deployment milestone |

The Node.js version is recorded in the root `.nvmrc`.
The frontend uses Next.js 16.3.8 and Tailwind CSS 4.3.3. The backend installed
NestJS 12.1.2, Nest CLI 12.0.8, and TypeScript 6.0.3; it uses ESM (`type: module`),
NodeNext module resolution, Express, Vitest tests, and Oxlint with type-aware linting.
Exact dependency versions are recorded in each application's npm lockfile.
Package lock files will be committed.

## 2. Application responsibilities

### Next.js frontend

- Display sign-in, dashboard, resource, editor, review, and library pages.
- Manage form interactions and show validation feedback.
- Communicate with the NestJS API.
- Display loading, success, and error states.
- Use Server and Client Components where appropriate.

Tailwind is configured in `frontend/postcss.config.mjs` and imported in
`frontend/src/app/globals.css`. Pages use Tailwind utility classes for styling.

Frontend checks improve usability.
They do not replace backend authorization or validation.

### NestJS backend

- Authenticate users and enforce roles and lesson ownership.
- Validate requests.
- Manage lesson saving, submission, revisions, and reviews.
- Manage curriculum resources.
- Coordinate database transactions.
- Call the AI provider and validate generated content.
- Return consistent API errors.

Organize the backend into feature modules:
authentication, users, resources, lessons, reviews, and AI.

Controllers handle HTTP requests.
Services implement business rules.
Database access is provided through a dedicated Prisma service.

### PostgreSQL and Prisma

PostgreSQL stores application data and enforces database constraints.

Prisma 7.10.0 provides database access and schema migration tooling. The current
schema contains User, CurriculumResource, Lesson, LessonRevision, Review, and
RevisionSource with JSONB content and reviewed migration checks/triggers. Session
is an additional operational model for authentication. The generated ESM client uses
`@prisma/adapter-pg`; the adapter owns a pool of up to five connections.
`PrismaModule` verifies the returned `SELECT 1 AS ok` result during Nest
initialization, before HTTP listens. Connection acquisition, driver queries, and
server statements each have five-second limits, with a separate 12-second
initialization deadline. Failures are sanitized; failed
initialization and SIGINT/SIGTERM shutdown disconnect the client.
The HTTP adapter tracks and closes open sockets on shutdown, including unfinished
requests, so server disposal cannot wait indefinitely on those connections.
This can interrupt in-flight HTTP requests; database cleanup is still awaited.
Only the NestJS backend connects to the database.

Migration files are reviewed and committed.
Production schema changes use the migration deployment process for the selected Prisma version.

Prisma does not replace authorization, runtime validation,
transaction design, or concurrency controls.

## 3. Request flow

A typical save request follows this sequence:

1. The teacher edits a lesson in Next.js.
2. Next.js sends a request to the NestJS API.
3. NestJS authenticates the user and checks ownership.
4. NestJS validates the request and applies workflow rules.
5. Prisma executes the database operations.
6. NestJS returns the result.
7. Next.js updates the interface.

Next.js does not implement a second copy of lesson business rules.
Any server-side forwarding or rendering must preserve the user's authenticated context when calling NestJS.

## 4. Authentication boundary

Authentication is owned by NestJS.

PostgreSQL-backed opaque sessions store only a SHA-256 token hash. NestJS
implements login/me/logout, Argon2id verification, default authentication and
teacher/admin role guards. Session row locks precede fresh PostgreSQL time checks;
eight-hour absolute and 30-minute idle expiry apply, activity is monotonic, and
logout revokes the presented session only. Valid authentication commits activity
before later authorization, including a 403. Public login/logout retain CSRF and
rate limits. Cleanup is an explicit bounded CLI, never an automatic startup task.

The shared HTTP setup enforces exact configured origins and a custom CSRF header
on unsafe JSON requests. Cookies are HttpOnly, host-only, SameSite=Lax; local HTTP
is loopback-only and production requires Secure `__Host-` cookies over HTTPS.
Limiter storage is bounded and process-local; production still needs shared/edge
limits, trusted ingress, same-site origins, and a cleanup scheduler. Account
provisioning, frontend sign-in, and transaction-time ownership/workflow enforcement
remain pending. See [design](authentication-design.md) and
[verification](authentication-verification.md).

Protected operations require backend role and ownership checks.

Deployment must account for cookie settings, HTTPS, CSRF protection, and the relationship between frontend and API origins.

## 5. Data integrity

- Submitted revisions and approved content remain immutable.
- The MVP uses Grade 4 Mathematics with a small set of original fraction resources
  labeled demonstration material without claiming official curriculum alignment.
  Exact resource text can be prepared during seeding.
- Reviews refer to the exact submitted revision.
- Related submission and review changes execute atomically.
- Concurrent edits and decisions must be detected or serialized.
- Authorize the requested action before a version-conflict response returns
  current lesson content, and include only content the caller is permitted to read.
- Database constraints support application rules.
- Resource changes preserve historical source information.
- Retired resources cannot be newly selected. Existing draft selections and copies
  of approved lessons retain trusted selection-time snapshots and remain
  submittable. Ordinary saves never refresh snapshots; an owning teacher may
  explicitly refresh a selected resource to its latest active version captured
  by NestJS. A retired resource cannot be refreshed; the retained snapshot stays
  unchanged. Submitted snapshots remain immutable.
- Submission requires positive whole-number durations of at least one minute for
  introduction, each activity, and assessment, summing to the positive total lesson
  duration. The `materials` field is a required array with nonblank supplied
  entries; an empty array means “No additional materials required.”

The [domain schema design](domain-schema.md) separates proposed database constraints
from NestJS validation and transactional concurrency rules. These mechanisms are
implemented in models and initial migration SQL where applicable. Authorization,
content/timing validation, lifecycle transitions, trusted snapshot handling,
latest-revision checks, and concurrency transactions still need NestJS services.
Immutable-row triggers do not prevent a later source-row INSERT; finalized source
sets remain a backend responsibility. See [domain verification](domain-schema-verification.md).

## 6. AI boundary

The frontend requests generation through NestJS.
NestJS calls the selected provider through an AI service adapter.

- Provider credentials remain on the backend.
- Generated content is validated before acceptance.
- AI output is treated as untrusted draft content.
- Generation cannot approve or publish a lesson.
- Failed generation preserves existing saved work.
- Request limits and timeouts will be added at the AI milestone.

Start development with sample responses before paid API calls.

## 7. Local development

Use Ubuntu through WSL and VS Code's WSL connection.

Current setup:

- Run Next.js and NestJS directly in Ubuntu in separate terminals.
- Next.js defaults to port 3000; NestJS defaults to port 3001.
- The backend validates an optional shell `PORT` override before creating the app:
  only decimal integers from 1 to 65535 are accepted.
- `GET /` returns `LessonForge API`; the frontend displays a minimal LessonForge heading.
- Frontend-to-API communication and origin configuration will be added when needed.
- PostgreSQL uses root `compose.yaml`, pinned to `postgres:17.11-bookworm`,
  published on `127.0.0.1:5433`, with a named volume and readiness health check.
  PostgreSQL and the health check use port `5432` inside the container.

Compose loads root `.env`; backend startup and Prisma CLI load only
`backend/.env` through Node `process.loadEnvFile`, preserving shell precedence.
Paths resolve relative to modules in source and compiled output. Runtime requires
a validated `DATABASE_URL` and validates optional `PORT`. Generation and schema
validation work without credentials. Generated TypeScript is ignored under
`backend/src/generated/prisma` and compiled within the existing Nest build.
Ordinary tests substitute database access; explicit `test:db` accepts only
`127.0.0.1:5433/lessonforge_dev` without query parameters and makes no writes.
See the [development setup guide](development-setup.md#docker-and-postgresql)
for first-start initialization and named-volume persistence.
Application containers will be introduced after the basic workflow works.

## 8. Configuration

- Record configuration names in `.env.example` files.
- Keep real credentials in ignored local environment files.
- Treat variables exposed to browser code as public.
- Keep database credentials, session secrets, and AI keys on the backend.
- Validate required backend configuration at startup.

## 9. Verification and delivery

The developer verified frontend browser styling and the default Turbopack
production build. Database-foundation checks, including agent test results and
live developer checks, are recorded in the
[verification guide](database-foundation-verification.md). Run the documented
checks using the [development setup guide](development-setup.md#checks).

GitHub Actions now implements separate frontend and backend checks using Node
from `.nvmrc` and database-free backend tests. Coverage, commands, limitations,
and historical local verification are recorded in [CI documentation](ci.md).
The developer confirmed `Frontend checks` and `Backend checks` passed on GitHub
and the CI PR was merged into `staging`. Saved protection rules for `staging` and
`main` require both checks and up-to-date branches before merging; reviewer
approval remains disabled for solo development. See the
[branching strategy](branching-strategy.md). The successful GitHub run is separate
from the earlier local network and port-binding restrictions recorded in the CI
guide; it does not establish `actionlint` or a separate local clean installation.

Add checks incrementally:

- Type checking and linting.
- Backend business-rule and permission tests.
- PostgreSQL integration tests for critical data behavior.
- Browser tests for the main teacher and administrator workflow.

Deployment will include an explicit migration step, health checks, and useful logs without credentials or sensitive content.

## 10. Repository layout

- frontend/ — Next.js application.
- backend/ — NestJS application, Prisma schema, and migrations.
- docs/ — specification, architecture, roadmap, and later design decisions.

Keep one Git repository at the project root.
Avoid nested Git repositories when scaffolding applications.
