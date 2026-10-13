# LessonForge backend

NestJS with TypeScript, ESM/NodeNext, and Prisma 7.10.0. `GET /` returns
`LessonForge API` at `http://localhost:3001` after database connectivity succeeds.

Startup and Prisma CLI explicitly load `backend/.env` with shell precedence.
`DATABASE_URL` is required at startup; `PORT` defaults to 3001 and must be a
whole decimal integer from 1 to 65535. Configuration errors never echo values.
The file path works from source and compiled output, independently of the
working directory. See the [development setup guide](../docs/development-setup.md#environment-files)
for matching Compose and backend credentials, initialization, and persistence.

From `backend/`, `npm run start:dev` generates the client and watches source.
`npm run build` generates and compiles it; `npm run start:prod` runs `dist/main.js`.
The schema contains the six [domain models](../docs/domain-schema.md) plus
operational Session storage in a new additive migration. Generated
source is ignored and excluded from
formatting and authored-code linting. No migrations are needed for `SELECT 1`.

`PrismaModule` creates a singleton service with an adapter-owned pool. Startup
checks the returned `SELECT 1 AS ok` value before HTTP listens. Connect/acquisition,
client query, and server statement limits are each five seconds, with a separate
12-second initialization deadline. Failures are
sanitized and release connections; Nest shutdown hooks handle SIGINT/SIGTERM.
The HTTP adapter tracks and closes open sockets during shutdown, including
connections with incomplete requests. This can interrupt an in-flight HTTP
request; Prisma disconnect still completes before the shutdown sequence finishes.

Checks without PostgreSQL:

```bash
npm run prisma:validate
npm run prisma:generate
npm run lint
./node_modules/.bin/tsc --noEmit
npm run build
npm test
npm run test:e2e
```

Generation and validation do not require credentials. Unit tests use fakes and
ordinary HTTP tests override the database provider. HTTP tests need local port
binding permission. `npm run test:db` is separate: it requires the local database
at `127.0.0.1:5433/lessonforge_dev`, rejects URL query parameters, executes only
`SELECT 1`, and closes the client. It creates no tables or data.

`npm run test:constraints` applies migrations and tests real PostgreSQL enforcement
only against an acknowledged, empty disposable database on port 5434. It never
loads `.env` or falls back to `DATABASE_URL`; see the
[isolated procedure](../docs/development-setup.md#initial-migration-and-isolated-constraint-verification)
and [verification evidence](../docs/domain-schema-verification.md).

On 2026-10-09, the developer confirmed the initial migration applied to
`lessonforge_dev`, Prisma reported up-to-date migration status, and the backend
build and compiled startup succeeded. `GET /` returned HTTP 200 with body
`LessonForge API`; Ctrl+C returned promptly to the shell. See the
[domain verification evidence](../docs/domain-schema-verification.md) for this
later developer run and the earlier isolated agent checks. This run predates the
Session migration. Backend authentication is now implemented; Session migration
application to development, provisioning, frontend sign-in, seeding, workflow
services, AI, and deployment remain pending. See the [CI guide](../docs/ci.md)
for the developer-confirmed successful workflow; CI remains database-free.

Backend auth endpoints are `POST /auth/login`, `GET /auth/me`, and
`POST /auth/logout`; `GET /` remains explicitly public. The shared HTTP policy uses
exact browser origins, JSON/custom-header CSRF checks on unsafe requests, host-only
HttpOnly cookies, and process-local bounded rate limits. Protected requests use
fresh PostgreSQL time after session row locks for absolute/idle expiry and activity.
See [design](../docs/authentication-design.md) and
[verification](../docs/authentication-verification.md).

`npm run test:auth:db` applies the full migration chain and tests authentication
only on a fresh disposable target under the same guards as `test:constraints`.
The two suites require different fresh containers; neither is ordinary CI.
`npm run sessions:cleanup` explicitly deletes invalid operational session rows
(up to 10,000) using normal backend configuration after build/migration. It is never
a startup/CI task. Account provisioning and frontend sign-in remain later steps.
See [procedures](../docs/development-setup.md#backend-authentication-step-1).
