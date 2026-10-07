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
Only generator and datasource blocks exist in `prisma/schema.prisma`; there are
no domain or placeholder models. Generated source is ignored and excluded from
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

Domain schema design, authentication, lessons, AI, deployment, and CI are deferred.
