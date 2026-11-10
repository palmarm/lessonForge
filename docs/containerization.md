# Local application container verification

This guide packages the Next.js frontend and NestJS backend alongside an isolated
PostgreSQL fixture stack. It verifies container mechanics, backend startup
connectivity and unauthenticated browser-to-API transport.
The fixture database remains **unmigrated**: no application tables, accounts or
lesson data are created. `GET /` returns a fixed process response; it is neither a
database-readiness nor a schema-readiness endpoint. Its Compose health check does
not detect a database outage after startup.

Authentication and workflow acceptance, migrations, provisioning, HTTPS, hosting,
access restrictions, backups and operational readiness remain separate. The
[roadmap's unresolved checks](roadmap.md#current-planning-checkpoint--2026-11-06)
remain open. AI follows restricted staging and remains required for the full MVP.

## Image and build context

Run commands from the repository root in Bash under Ubuntu/WSL2. Docker Desktop
must expose its Linux engine and Compose plugin to this WSL distribution. Check
`docker version` and `docker compose version` before proceeding. Stop if either
fails; installing application dependencies on the host will not fix Docker access.
BuildKit (the Docker Desktop default) is required for offline build steps and the
local-output context audit.

`backend/Dockerfile` uses `backend/` as its build context, not the repository root.
Its Debian Bookworm slim Node version is `24.21.0`, matching `.nvmrc`. The
[Docker Hub tag metadata](https://hub.docker.com/v2/repositories/library/node/tags/24.21.0-bookworm-slim)
was checked on 2026-11-09: the tag was active, with Linux amd64 and arm64 images.
The Dockerfile pins its multi-platform index digest:
`sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20`.
Update the exact tag/digest deliberately when `.nvmrc` changes; never silently
substitute a different Node version.

The stages are:

1. `base`: Node with CA certificates, OpenSSL for Prisma tooling/TLS, and the C++
   runtime needed by native dependencies. Every stage shares this Debian/glibc base.
2. `build`: `npm ci --include=dev`, then `npm run build`. The existing `prebuild`
   generates Prisma TypeScript; Nest compiles it into `dist/generated/prisma`.
   Generation/compilation run with networking disabled and no database configuration.
3. `production-dependencies`: derives from the completed build, then prunes dev
   and optional dependencies. Prisma CLI is an optional peer of `@prisma/client`,
   so omitting dev alone retains its unnecessary tooling subtree. The Node API
   does not need that peer or `pg`'s Cloudflare-only optional adapter; Argon2's
   packaged native addon is retained. This dependency chain avoids concurrent
   full/dev-only installs.
4. `runtime`: copies production dependencies, the complete `dist/` tree and the ESM
   `package.json`. It runs as `node`, with direct `node dist/main.js` startup.

The final stage runs an offline non-root/Prisma/WASM import and ephemeral Argon2id
hash/verify assertion, and rejects a retained Prisma CLI or environment file.
Failure fails the build; it never connects to a database or
prints a password/hash. Argon2 uses its packaged native binary; no compiler packages
are added speculatively. Unsupported native targets must fail visibly rather than
being worked around with host `node_modules`.

`backend/.dockerignore` excludes host dependencies, generated Prisma, builds,
environment files (including examples), common credential files, logs and caches.
Explicit `COPY` instructions further limit builder inputs. Runtime contains no
Prisma CLI or migration SQL. No build argument or image environment contains
database credentials. npm downloads, Debian packages and initial image pulls still
need network access; the later compilation step does not.

### Prisma retention and optional-dependency boundary

The two dependency paths in `backend/package.json` and `backend/package-lock.json`
explain the original pruning result:

- `backend -> prisma@7.10.0` is a direct **dev** dependency.
- `backend -> @prisma/client@7.10.0 -> prisma@*` is an **optional peer** path.
  The installed CLI consequently has `devOptional: true`, not exclusively `dev`.
  `--omit=dev` alone retains it through the production client's peer relationship.
  Its subtree includes `@prisma/config`, engines, local development/Studio tools,
  `mysql2` and `postgres`; these are not the PostgreSQL API's runtime adapter.
- `@prisma/client -> typescript@>=5.4.0` is another optional peer path. The locked
  `typescript@6.0.3` is also `devOptional`; compiled JavaScript needs neither it nor
  Prisma generation/migration tooling. Generation and compilation precede pruning.

Relevant exclusions with `--omit=dev --omit=optional` are:

| Package/path                                                               | Function excluded and supported-runtime implications                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@prisma/client -> prisma`, `typescript`                                   | Build-time generation/type checking and CLI operations, not compiled client execution. Migrations remain a separate operation, not an API-image capability.                                                                                                                     |
| `@prisma/adapter-pg -> pg@8.23.1 -> pg-cloudflare@1.4.1`                   | Cloudflare Workers sockets, not Node's `net`/`tls` sockets. This Debian Node image does not support a Workers runtime. Ordinary Node PostgreSQL TLS does not require this package, but TLS was not exercised against the fixture.                                               |
| `pg -> pg-native` (optional peer)                                          | Opt-in libpq driver (`pg.native` / `NODE_PG_FORCE_NATIVE`), not used by LessonForge. It was already absent from the lockfile, so pruning did not remove a previously supported native-driver path. Do not enable that switch for this image.                                    |
| Nest's optional validation/serialization, microservice and WebSocket peers | `class-validator`, `class-transformer`, `@nestjs/microservices` and `@nestjs/websockets` were already absent from the lockfile. The API uses its existing explicit validators and Express HTTP; adding those framework features later requires dependency/package verification. |
| Dev-tool optional platform binaries and `debug`'s optional color support   | Lint/test/build or terminal presentation, not API behavior. No runtime dependency on them was identified.                                                                                                                                                                       |

An optional peer declaration does **not** make every installation of that package
optional: `@nestjs/platform-express` is also a direct production dependency and is
retained despite being an optional peer of `@nestjs/core`. Argon2's Linux native
addon is shipped inside `argon2@0.45.1`, loaded by its ordinary `node-gyp-build`
dependency, not an optional platform package removed by this pruning.

The rejection assertion checks the exact `node_modules/prisma` **CLI package**
directory. It does not reject names containing `prisma` or the `@prisma` scope.
Required `@prisma/client` (including compiler JS/WASM), `client-runtime-utils`,
`adapter-pg`, `driver-adapter-utils`, `debug` and `dist/generated/prisma` remain.
Imports and WASM compilation are positively checked as well. This is an assertion
for the current locked, top-level CLI placement, not a recursive tooling scanner
for every possible future dependency layout.

The completed Linux/amd64 checks establish loading of the generated client and
adapter, compiler-WASM compilation, Argon2id hash/verify, authenticated PostgreSQL
startup/query, root HTTP response, sanitized negative startup and idle shutdown
**after pruning**. They do not establish migrated-model CRUD, transactions, full
authentication/workflow acceptance, PostgreSQL TLS, every lazy/optional code path,
arm64 execution or shutdown under load. Those limitations are not evidence that
an excluded optional dependency is needed by a current supported API path; revisit
the pruning decision when dependencies or supported features change.

## Separate fixture configuration

The only input is a new fixture password. The example
`.env.container-check.example` deliberately leaves it empty so Compose reports an
actionable error until supplied. The existing `.gitignore` excludes
`.env.container-check` while permitting the example.

Create a fresh, URL-safe hexadecimal fixture password without displaying it. This
command writes only the ignored fixture file, with owner-only permissions, and
refuses to overwrite an existing file:

```bash
node --input-type=module -e '
  import { randomBytes } from "node:crypto";
  import { writeFileSync } from "node:fs";
  writeFileSync(".env.container-check", "CONTAINER_CHECK_DB_PASSWORD=" + randomBytes(32).toString("hex") + "\n", { flag: "wx", mode: 0o600 });
'
```

An existing fixture file should be reused only after confirming that you created
it for this stack. Never copy development credentials. Changing this file does not
change a password already initialized in the retained fixture volume; do not delete
volumes to resolve a mismatch.

Define this helper for the current terminal. Its explicit `--env-file` prevents
Compose from automatically loading the development root `.env`; `--file` prevents
loading development Compose. Remove a same-named shell override without reading it:

```bash
unset CONTAINER_CHECK_DB_PASSWORD
lfcc() {
  docker compose \
    --env-file .env.container-check \
    --file compose.container-check.yaml \
    --project-name lessonforge-container-check "$@"
}
```

Use `lfcc` for every command below. Do not substitute bare `docker compose`.
Do not print interpolated `compose config`, container environment dumps, or the
fixture file. Validate quietly:

```bash
lfcc config --quiet
git check-ignore .env.container-check
```

To check missing-value validation without reading any environment file, the
following must fail with the documented fixture-variable message:

```bash
if lfcc_missing_output=$(env -u CONTAINER_CHECK_DB_PASSWORD docker compose \
  --env-file /dev/null --file compose.container-check.yaml \
  --project-name lessonforge-container-check config --quiet 2>&1); then
  lfcc_missing_status=0
else
  lfcc_missing_status=$?
fi
test "$lfcc_missing_status" -eq 1
[[ "$lfcc_missing_output" == *"Generate a fixture-only CONTAINER_CHECK_DB_PASSWORD"* ]]
```

A missing Docker executable/plugin is a blocker, not a successful validation test.
Stop after an unexpected failure in any subsequent command.

## Build, start and inspect

Build sequentially to limit memory use. Neither command starts any service.
Frontend compilation runs with networking disabled; API/database access is
unnecessary. The image build also serves as the production frontend build check;
do not repeat an equivalent host build for this slice.

```bash
lfcc build api
lfcc build frontend
docker image inspect lessonforge-backend:container-check \
  --format 'User={{.Config.User}} Command={{json .Config.Cmd}}'
docker run --rm --network none --entrypoint node \
  lessonforge-backend:container-check --input-type=module -e '
    if (process.getuid() === 0 || process.version !== "v24.21.0") process.exit(1);
    console.log("Node", process.version, "UID", process.getuid());
  '
```

Expect user `node`, command `["node","dist/main.js"]`, a nonzero UID, and the exact
Node version. The build must also pass the final-stage Prisma/WASM and Argon2
assertions. Do not infer those results from an older host build.

Before first startup, check for existing containers in this project. The last
command must succeed (empty output); otherwise stop and establish ownership rather
than replacing/stopping existing containers:

```bash
lfcc_existing=$(lfcc ps --all --quiet) && test -z "$lfcc_existing"
```

Start only this fixture stack and wait for health. A port/name collision is a
failure to investigate, not permission to stop another service:

```bash
lfcc up --detach --no-build --wait --wait-timeout 90
lfcc ps
lfcc logs --no-color api
curl --fail --silent --show-error http://localhost:3101/
```

Expect a healthy PostgreSQL service, successful authenticated database startup,
and HTTP 200 with exactly `LessonForge API`. The API waits for PostgreSQL health,
then independently verifies authenticated `SELECT 1 AS ok` before listening.
`pg_isready` alone does not verify credentials. No migration or account provisioning
occurs; the fixed root response works without application tables.

Confirm authenticated connectivity from the API container with a separate,
read-only metadata query, then verify the fixture's public schema is empty. These
commands print only fixture identity and a table count, not credentials:

```bash
lfcc exec -T api node --input-type=module -e '
  import { createDatabaseClient } from "./dist/prisma/prisma.service.js";
  const client = createDatabaseClient(process.env.DATABASE_URL);
  try {
    const rows = await client.$queryRawUnsafe("SELECT current_database() AS database, current_user AS role, 1 AS ok");
    if (rows.length !== 1 || rows[0].database !== "lessonforge_container_check" || rows[0].role !== "lessonforge_container_check" || rows[0].ok !== 1) throw new Error("Unexpected fixture result");
    console.log("Authenticated fixture connectivity verified");
  } finally {
    await client.$disconnect();
  }
'
lfcc exec -T db psql --username lessonforge_container_check \
  --dbname lessonforge_container_check --tuples-only --no-align \
  --command "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
```

The SQL is fixed read-only text; it accepts no request input. Expect the query to
succeed and the table count to be `0`. These are explicit one-time checks, not
ongoing application readiness checks. Successful startup produced no API log lines
in the verified run below; no startup-log-message pass is claimed.

The stack has its own default network and named volume:

| Location                   | Address or resource                                           |
| -------------------------- | ------------------------------------------------------------- |
| Host/browser API           | `http://localhost:3101`, published only on `127.0.0.1`        |
| API inside its container   | port `3001`                                                   |
| API to fixture database    | Compose DNS `db:5432`, database `lessonforge_container_check` |
| Fixture database host port | None                                                          |
| Fixture volume             | `lessonforge-container-check_postgres_data`                   |
| Fixture network            | `lessonforge-container-check_default`                         |

There are no external network/volume attachments or source bind mounts. The
development `lessonforge` project and its resources are not used. A container's
`localhost` refers to itself; `db` resolves inside this stack, not in a browser.
Windows-to-WSL localhost forwarding must be checked separately if Windows access
differs from the WSL `curl` result.

The PostgreSQL image initializes a bootstrap superuser for this fixture only.
This is not the least-privilege runtime role required for staging.

The image defaults to `NODE_ENV=production`. Only this local Compose API service
overrides it to `development`, permitting the unchanged loopback HTTP cookie mode.
It still runs compiled JavaScript, not a watcher. Origins use API port `3101` and
UI port `3100`. This override establishes
no production transport security. Production requires explicit HTTPS origins and
Secure cookie mode. Browser cookies do not isolate ports; any later browser check
should use a separate profile from development.

## Frontend standalone image and browser transport

`frontend/Dockerfile` uses **frontend/** as context and the same verified, pinned
Node 24.21.0 Bookworm/glibc base as the API. Registry inspection on 2026-11-10
confirmed the index digest above. `dependencies` runs
`npm ci --include=dev --include=optional` from the frontend lockfile inside Linux.
Do not copy the backend's optional-dependency pruning: Next's SWC, Tailwind's
Oxide/Lightning CSS and Sharp use platform-specific optional dependencies. The
build needs these Linux binaries; standalone tracing chooses the runtime files.
No host `node_modules`, dependency upgrade or lockfile edit is involved.

The `build` stage copies explicit configuration, `src/` and `public/`, then runs
`npm run build` with `--network=none`. The current layout uses local styles and
has no build-time API/database or remote-font requirement. The `runtime` stage
copies these outputs, all owned by `node`:

| Build output | Runtime location | Purpose |
| --- | --- | --- |
| `.next/standalone/` | `/app/` | Generated `server.js`, traced dependencies and server output |
| `.next/static/` | `/app/.next/static/` | Generated CSS and JavaScript; not copied by standalone automatically |
| `public/` | `/app/public/` | Public assets such as `/file.svg` |

The App Router favicon is compiled from `src/app/favicon.ico` into server output;
it is also checked over HTTP. The container runs as `node` (UID 1000) with
`NODE_ENV=production`, `HOSTNAME=0.0.0.0`, `PORT=3000`, and exec-form
`CMD ["node", "server.js"]`. Node receives SIGTERM directly. There is no npm wrapper,
watcher, source mount, proxy or new authentication layer. See Next's
[standalone documentation](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).

Compose explicitly passes `NEXT_PUBLIC_API_BASE_URL=http://localhost:3101` as a
**build argument**. This is public configuration embedded in browser JavaScript,
not a secret. Changing the browser API origin requires rebuilding the frontend;
setting a runtime variable cannot rewrite the existing bundle. A direct build
must likewise pass `--build-arg NEXT_PUBLIC_API_BASE_URL=http://localhost:3101`.
Runtime `HOSTNAME` and `PORT` instead configure the standalone listener. Never pass
database credentials, session tokens or provider keys through a frontend ARG/ENV.
See Next's [public environment configuration](https://nextjs.org/docs/app/guides/environment-variables).
No fixture example change is needed: its only input remains the database password.

| Caller/location | Address |
| --- | --- |
| Browser UI | `http://localhost:3100`, published only as `127.0.0.1:3100:3000` |
| Frontend server inside its container | `0.0.0.0:3000` |
| Browser API requests | `http://localhost:3101`, never `http://api:3001` |
| Compose service DNS | `api:3001` and `db:5432`, available only inside the fixture network |

`localhost` in a browser refers to the browser's machine; inside a container it
refers to that container. The existing client transport directly calls the public
API origin with `credentials: "include"`. Nest retains its existing
`AUTH_ALLOWED_ORIGINS=http://localhost:3100`, `API_PUBLIC_ORIGIN=http://localhost:3101`
and explicit **API-only** `NODE_ENV=development` / `AUTH_COOKIE_MODE=local-http`
override. Production authentication still rejects local HTTP. The frontend has no
startup dependency on API/database. Its health check only checks the public shell,
and the API health check remains a process check, not ongoing database readiness.

After the sequential builds above, inspect and probe the final frontend image:

```bash
docker image inspect lessonforge-frontend:container-check \
  --format 'User={{.Config.User}} Command={{json .Config.Cmd}} StopSignal={{.Config.StopSignal}}'
docker run --rm --network none --entrypoint node lessonforge-frontend:container-check -e '
  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  assert.equal(process.getuid(), 1000);
  assert.equal(process.version, "v24.21.0");
  assert.equal(process.env.NODE_ENV, "production");
  assert.equal(process.env.HOSTNAME, "0.0.0.0");
  assert.equal(process.env.PORT, "3000");
  for (const file of ["server.js", ".next/static", "public/file.svg"]) assert.ok(fs.existsSync(file));
  assert.ok(!fs.existsSync(".env") && !fs.existsSync(".env.local"));
  require("sharp")({create:{width:1,height:1,channels:3,background:"white"}}).png().toBuffer()
    .then(() => console.log("Non-root standalone packaging and Sharp native runtime passed"));
'
```

Use the ownership preflight in the build/start section before creating containers.
To establish independent frontend startup, start it before the other services,
then start the complete isolated stack:

```bash
lfcc up --detach --no-build --no-deps --wait --wait-timeout 90 frontend
curl --fail --silent --show-error --output /dev/null http://localhost:3100/sign-in
lfcc up --detach --no-build --wait --wait-timeout 90
lfcc ps
```

### HTTP and header checks

Inspect `/auth/me` before deciding whether migrations are necessary:
`AuthenticationGuard` in `backend/src/auth/auth.guards.ts` calls the repository only
when a session cookie token exists. **With no cookie**, it immediately returns 401
with `Authentication required.`; no application table is needed. Keep this check
cookie-free. A real/stale cookie could query the unmigrated database instead.
Do not provision users or infer authenticated workflow acceptance from this check.

Run from the repository root after startup. This fetches the rendered shell and
all referenced CSS/JS, compares a public asset and favicon against source bytes,
and checks CORS headers/preflights for allowed and rejected origins. These are
HTTP checks, not browser evidence:

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const ui = 'http://localhost:3100';
const api = 'http://localhost:3101';
const get = (url, options = {}) => fetch(url, {signal: AbortSignal.timeout(30000), ...options});
const page = await get(`${ui}/sign-in`);
assert.equal(page.status, 200);
assert.match(page.headers.get('content-type'), /text\/html/);
const html = await page.text();
assert.match(html, /LessonForge/);
const assets = [...new Set([...html.matchAll(/(?:src|href)="([^" ]+)"/g)].map(m => m[1]).filter(p => p.startsWith('/_next/static/') && /\.(css|js)(?:\?|$)/.test(p)))];
assert.ok(assets.some(p => p.includes('.css')));
assert.ok(assets.some(p => p.includes('.js')));
for (const path of assets) {
  const r = await get(ui + path);
  assert.equal(r.status, 200, path);
  assert.match(r.headers.get('content-type'), path.includes('.css') ? /text\/css/ : /javascript/);
  assert.ok((await r.arrayBuffer()).byteLength > 0);
}
for (const [url, file] of [['/file.svg', 'frontend/public/file.svg'], ['/favicon.ico', 'frontend/src/app/favicon.ico']]) {
  const r = await get(ui + url);
  assert.equal(r.status, 200);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), await readFile(file));
}
const me = await get(`${api}/auth/me`, {headers:{Origin:ui}});
assert.equal(me.status, 401);
assert.equal(me.headers.get('access-control-allow-origin'), ui);
assert.equal(me.headers.get('access-control-allow-credentials'), 'true');
assert.match(me.headers.get('vary'), /Origin/);
assert.equal((await me.json()).message, 'Authentication required.');
const preflight = await get(`${api}/auth/login`, {method:'OPTIONS',headers:{Origin:ui,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-lessonforge-csrf'}});
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get('access-control-allow-origin'), ui);
assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
assert.match(preflight.headers.get('access-control-allow-headers').toLowerCase(), /content-type/);
assert.match(preflight.headers.get('access-control-allow-headers').toLowerCase(), /x-lessonforge-csrf/);
for (const origin of ['http://localhost:3000', 'http://untrusted.invalid']) {
  const r = await get(`${api}/auth/me`, {headers:{Origin:origin}});
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  const p = await get(`${api}/auth/login`, {method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-lessonforge-csrf'}});
  assert.equal(p.headers.get('access-control-allow-origin'), null);
}
console.log(`HTTP/header checks passed: /sign-in, ${assets.length} generated CSS/JS assets, public SVG, byte-matching favicon, cookie-free /auth/me 401, credentialed CORS/preflight, denied origins`);
JS
```

The fixture catalog query earlier must still report zero public tables.
The allowed-origin 401 must include the exact UI origin, credentials `true` and
`Vary: Origin`. The login OPTIONS preflight must allow POST, Content-Type and
X-LessonForge-CSRF. The checks send no login POST and no cookies. Header checks do
not establish cookie attributes or authenticated CSRF behavior.

### Browser checks

Use a **separate browser profile** from development for manual checks. Cookies
for localhost are shared across ports, so an existing development session can
change `/auth/me` behavior. The automated probe below creates a fresh in-memory
browser context with no cookies and performs no login or intercepted API responses.
It checks the real image on port 3100 against the real API on port 3101.

If Playwright and Chromium are already installed, set `PLAYWRIGHT_MODULE` to the
absolute path of that installation's `index.mjs` and configure its existing browser
path/library environment if needed. Do not install packages or change the lockfile
for this check. In this run the existing cached runtime needed
`PLAYWRIGHT_BROWSERS_PATH`, `LD_LIBRARY_PATH`, `ALSA_CONFIG_DIR` and `ALSA_CONFIG_PATH`.
Run this with those environment variables. For the cached runtime used in this
workspace, the command prefix was:

```bash
export PLAYWRIGHT_MODULE=/home/mariga/design-work/lessonforge-ui/node_modules/playwright/index.mjs
export PLAYWRIGHT_BROWSERS_PATH=/home/mariga/.cache/lessonforge-browser-runtime/browsers
export LD_LIBRARY_PATH=/home/mariga/.cache/lessonforge-browser-runtime/root/usr/lib/x86_64-linux-gnu
export ALSA_CONFIG_DIR=/home/mariga/.cache/lessonforge-browser-runtime/root/usr/share/alsa
export ALSA_CONFIG_PATH=/home/mariga/.cache/lessonforge-browser-runtime/root/usr/share/alsa/alsa.conf
```

These paths identify already installed LessonForge verification tools, not image
inputs or application dependencies. Adjust them for an existing installation on
another machine. Then run:

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch({headless:true});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [], requests = [], responses = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (/hydrat|did not match|Minified React error/i.test(m.text())) errors.push(m.text()); });
  page.on('request', r => { if (new URL(r.url()).port === '3101') requests.push({url:r.url(),method:r.method()}); });
  page.on('response', r => { if (new URL(r.url()).port === '3101') responses.push({url:r.url(),status:r.status()}); });
  for (const route of ['/sign-in','/drafts','/library','/admin/reviews']) {
    const me = page.waitForResponse(r => r.url() === 'http://localhost:3101/auth/me');
    await page.goto(`http://localhost:3100${route}`);
    assert.equal((await me).status(), 401);
    await page.getByLabel('Email', {exact:true}).waitFor();
    await page.getByLabel('Password', {exact:true}).waitFor();
    await page.getByRole('button', {name:'Sign in',exact:true}).waitFor();
    assert.equal(await page.getByRole('navigation', {name:/Teacher|Administrator/}).count(), 0);
    assert.equal(await page.getByLabel('Title', {exact:true}).count(), 0);
    // Exercise hydrated React state without making a login request.
    await page.getByLabel('Password', {exact:true}).fill('synthetic-ui-only');
    await page.getByRole('button', {name:'Show password',exact:true}).click();
    assert.equal(await page.getByLabel('Password', {exact:true}).getAttribute('type'), 'text');
    assert.ok(await page.locator('link[rel="stylesheet"]').count() > 0);
    assert.ok(await page.getByRole('heading', {name:'Sign in',exact:true}).evaluate(e => parseFloat(getComputedStyle(e).fontSize)) > 20);
  }
  const result = await page.evaluate(async () => {
    const r = await fetch('http://localhost:3101/auth/me', {credentials:'include'});
    return {status:r.status,body:await r.json()};
  });
  assert.equal(result.status, 401);
  assert.equal(result.body.message, 'Authentication required.');
  assert.ok(requests.every(r => r.url === 'http://localhost:3101/auth/me' && r.method === 'GET'));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({browser:browser.version(),routes:4,requests,responses,hydrationErrors:errors,credentialedBrowserRead:result.status},null,2));
  await context.close();
} finally { await browser.close(); }
JS
```

Expected: actual GETs to `http://localhost:3101/auth/me` return 401, the sign-in form
becomes interactive, Show password updates React state, CSS applies, protected
routes show sign-in and no authenticated workspace controls, and there are no
page errors or hydration warnings. A public route heading may still render;
backend authentication remains the authorization boundary. A credentialed browser
fetch must expose the 401 body, establishing that CORS permits the browser read.

If browser execution is blocked, leave these checks pending and manually:

1. Open `http://localhost:3100/sign-in` in a separate profile and check styled UI,
   favicon, loaded CSS/JS, and the console for hydration errors.
2. Confirm Network shows GET `http://localhost:3101/auth/me` with 401 and a usable
   response; confirm sign-in fields and Show password work without signing in.
3. Open `/drafts`, `/library` and `/admin/reviews`; confirm sign-in is shown and
   authenticated workspace controls/content remain unavailable.

### Frontend SIGTERM and checks

The frontend grace period is **30 seconds**. After HTTP/browser checks, measure
idle shutdown and require exit 0 or 143, no OOM/runtime error, and no SIGKILL:

```bash
lfcc_frontend_id=$(lfcc ps --quiet frontend)
test -n "$lfcc_frontend_id"
lfcc_frontend_signal_since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
lfcc_frontend_stop_started=$(date +%s)
lfcc stop frontend
lfcc_frontend_stop_elapsed=$(( $(date +%s) - lfcc_frontend_stop_started ))
printf 'Frontend stop took %s seconds\n' "$lfcc_frontend_stop_elapsed"
docker inspect "$lfcc_frontend_id" \
  --format 'Exit={{.State.ExitCode}} OOMKilled={{.State.OOMKilled}} Error={{.State.Error}}'
test "$lfcc_frontend_stop_elapsed" -lt 30
lfcc_frontend_exit=$(docker inspect "$lfcc_frontend_id" --format '{{.State.ExitCode}}')
test "$lfcc_frontend_exit" -eq 0 || test "$lfcc_frontend_exit" -eq 143
docker events --since "$lfcc_frontend_signal_since" --until "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --filter "container=$lfcc_frontend_id" --filter event=kill --format '{{json .Actor.Attributes}}'
```

Run the API shutdown check below and `lfcc down --timeout 30` only for containers
created by this task. Keep the fixture file and volume. Never use `--volumes`,
global pruning or development Compose cleanup. Idle shutdown does not establish
in-flight request draining or performance under load.

Run the existing frontend checks sequentially:

```bash
npm run lint --prefix frontend
npm run typecheck --prefix frontend
npm test --prefix frontend
git diff --check -- frontend/Dockerfile frontend/.dockerignore frontend/next.config.ts \
  compose.container-check.yaml .env.container-check.example docs/containerization.md docs/development-setup.md
git diff --check
```

The offline container production build already covers `npm run build`; a second
host build is unnecessary. The existing rendered suite uses intercepted API
fixtures and a separate host build/configuration; it does not substitute for the
real unauthenticated container browser check above.

## Safe startup failures

Run these sequentially after a successful build. This helper requires exit **1**
and the expected application message, and rejects leaked URLs or known synthetic
passwords. A Docker error (even exit 1) is not a pass. It captures output instead
of printing potentially unexpected diagnostics:

```bash
lfcc_expect_failure() {
  local expected="$1" output status
  shift
  if output=$("$@" 2>&1); then
    status=0
  else
    status=$?
  fi
  if [ "$status" -ne 1 ] || [[ "$output" != *"$expected"* ]] ||
    [[ "$output" == *"postgresql://"* || "$output" == *"postgres://"* ||
       "$output" == *"intentionally_wrong_fixture_password"* || "$output" == *"fixture_only"* ]]; then
    printf 'Failure check did not meet its expected exit/message/redaction contract.\n' >&2
    return 1
  fi
  printf 'Expected sanitized startup failure verified.\n'
}
```

Missing database configuration, with local auth settings otherwise valid:

```bash
lfcc_expect_failure 'DATABASE_URL must be a PostgreSQL URL' \
  docker run --rm --network none --env NODE_ENV=development \
  lessonforge-backend:container-check
```

Wrong fixture password, while the healthy fixture database remains running. This
one-off API has no published port and does not replace the running API:

```bash
lfcc_expect_failure 'Check PostgreSQL readiness and backend DATABASE_URL configuration.' \
  lfcc run --rm --no-deps \
  --env DATABASE_URL=postgresql://lessonforge_container_check:intentionally_wrong_fixture_password@db:5432/lessonforge_container_check \
  api
```

Unavailable database: a network-disabled one-off container cannot reach any
database. These are synthetic credentials, not the configured fixture password:

```bash
lfcc_expect_failure 'Check PostgreSQL readiness and backend DATABASE_URL configuration.' \
  docker run --rm --network none --env NODE_ENV=development \
  --env DATABASE_URL=postgresql://fixture:fixture_only@127.0.0.1:5432/lessonforge_container_check \
  lessonforge-backend:container-check
```

Also confirm that the production default does not accept implicit local HTTP:

```bash
lfcc_expect_failure 'Invalid authentication origin or cookie configuration.' \
  docker run --rm --network none lessonforge-backend:container-check
```

The last case should reject authentication origin/cookie configuration before
database access. None of these commands stops or reconfigures a database.

## SIGTERM and fixture shutdown

Compose gives the API 30 seconds to handle SIGTERM. The direct Node command lets
Nest receive it; existing hooks drain accepted work and disconnect Prisma. Measure
this on the built container rather than assuming historical host results apply:

```bash
lfcc_api_id=$(lfcc ps --quiet api)
test -n "$lfcc_api_id"
lfcc_stop_started=$(date +%s)
lfcc stop api
lfcc_stop_elapsed=$(( $(date +%s) - lfcc_stop_started ))
printf 'Stop took %s seconds\n' "$lfcc_stop_elapsed"
docker inspect "$lfcc_api_id" \
  --format 'Exit={{.State.ExitCode}} OOMKilled={{.State.OOMKilled}} Error={{.State.Error}}'
test "$lfcc_stop_elapsed" -lt 30
lfcc_exit_code=$(docker inspect "$lfcc_api_id" --format '{{.State.ExitCode}}')
test "$lfcc_exit_code" -eq 0 || test "$lfcc_exit_code" -eq 143
```

Require `OOMKilled=false`, no runtime error, and exit before the grace period.
Exit 143 can represent Nest completing cleanup and re-raising SIGTERM; exit 137
is not accepted. A timeout/forced termination is a failed check. This idle check
does not benchmark shutdown under active password hashing or workflow traffic.

After inspecting results, remove only this task's containers and network. The
fixture volume is retained by default:

```bash
lfcc down --timeout 30
```

Do not add `--volumes`, use global pruning, or run development Compose cleanup.
Retained fixture storage is for local mechanics checks only, not staging data.

## Synthetic context and image exclusion audit

Run this only after Docker works. Use an isolated source export and synthetic
markers; never create markers in real environment files. In this slice application
source is unchanged, so `git archive HEAD backend` supplies it without reading
ignored files. The two Docker files under review are copied separately. If future
application source has uncommitted edits, this audit export does not represent them.

```bash
lfcc_audit_dir=$(mktemp -d /tmp/lessonforge-container-audit.XXXXXX)
git archive HEAD backend | tar -x -C "$lfcc_audit_dir"
cp backend/Dockerfile backend/.dockerignore "$lfcc_audit_dir/backend/"
python3 - "$lfcc_audit_dir/backend" <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1])
for name in (
    '.env', '.env.audit', 'nested/.env.audit', '.npmrc', 'audit.pem',
    'audit.log', '.cache/audit', '.npm/audit', 'node_modules/audit',
    'dist/audit', 'src/generated/prisma/audit', 'audit.tsbuildinfo',
):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('# LESSONFORGE_SYNTHETIC_EXCLUSION_MARKER\n')
PY
```

First export the effective Docker context using a scratch image. This checks
Docker's actual ignore semantics, including files not copied by the application
Dockerfile. Then build the real image sequentially from the marked source:

```bash
docker build --file - --output "type=local,dest=$lfcc_audit_dir/context" \
  "$lfcc_audit_dir/backend" <<'DOCKERFILE'
FROM scratch
COPY . /
DOCKERFILE
docker build --tag lessonforge-backend:container-audit "$lfcc_audit_dir/backend"
docker image save --output "$lfcc_audit_dir/image.tar" lessonforge-backend:container-audit
```

Scan the exported context and **every saved final-image layer**, including deleted
files, plus image metadata. Assertions print no file content. An absence check of
the running filesystem alone would miss secrets copied and deleted in an earlier
layer. Builder context exclusion provides the corresponding builder boundary:

```bash
python3 - "$lfcc_audit_dir" <<'PY'
import json
from pathlib import Path
import sys
import tarfile

root = Path(sys.argv[1])
marker = b'LESSONFORGE_SYNTHETIC_EXCLUSION_MARKER'

def check(stream):
    tail = b''
    while chunk := stream.read(1024 * 1024):
        data = tail + chunk
        assert marker not in data, 'Synthetic marker leaked'
        tail = data[-len(marker):]

for path in (root / 'context').rglob('*'):
    if path.is_file():
        with path.open('rb') as stream:
            check(stream)
with tarfile.open(root / 'image.tar') as image:
    manifest = json.load(image.extractfile('manifest.json'))
    for entry in manifest:
        check(image.extractfile(entry['Config']))
        for name in entry['Layers']:
            with tarfile.open(fileobj=image.extractfile(name), mode='r|*') as layer:
                for member in layer:
                    if member.isfile():
                        check(layer.extractfile(member))
print('Synthetic marker absent from effective context and all final-image layers')
PY
```

This is scoped evidence for the configured exclusion patterns, not a general
secret detector. Review the Dockerfile's explicit inputs and absence of credential
ARG/ENV instructions as well. Keep the temporary audit directory for inspection;
no global or automatic volume cleanup is part of this procedure.

### Frontend synthetic audit

The frontend has its own `.dockerignore`; a backend audit does not verify it.
It excludes environment files (including examples), host dependencies/builds,
logs, coverage, caches and common credential locations. Explicit builder copies
and standalone-only runtime copies provide additional boundaries.

Create a separate export, copy the frontend files under review, and place only
synthetic markers into it. No real environment file is read or modified:

```bash
lfcc_frontend_audit=$(mktemp -d /tmp/lessonforge-frontend-audit.XXXXXX)
git archive HEAD frontend | tar -x -C "$lfcc_frontend_audit"
cp frontend/Dockerfile frontend/.dockerignore frontend/next.config.ts "$lfcc_frontend_audit/frontend/"
python3 - "$lfcc_frontend_audit/frontend" <<'PYTHON'
from pathlib import Path
import sys
root = Path(sys.argv[1])
for name in (
    '.env', '.env.local', 'nested/.env.audit', '.npmrc', '.netrc',
    '.git-credentials', '.aws/credentials', '.ssh/id_rsa', '.docker/config.json',
    '.vercel/auth.json', 'secrets/audit', 'credentials/audit',
    'audit.pem', 'audit.key', 'audit.p12', 'audit.pfx', 'audit.log',
    '.cache/audit', '.npm/audit', '.turbo/audit', '.yarn/audit', '.eslintcache',
    'node_modules/audit', '.next/audit', 'out/audit', 'dist/audit',
    'coverage/audit', 'audit.tsbuildinfo',
):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('LESSONFORGE_SYNTHETIC_FRONTEND_EXCLUSION_MARKER\n')
PYTHON
docker build --file - --output "type=local,dest=$lfcc_frontend_audit/context" \
  "$lfcc_frontend_audit/frontend" <<'DOCKERFILE'
FROM scratch
COPY . /
DOCKERFILE
docker build --tag lessonforge-frontend:container-audit \
  --build-arg NEXT_PUBLIC_API_BASE_URL=http://localhost:3101 "$lfcc_frontend_audit/frontend"
docker image save --output "$lfcc_frontend_audit/image.tar" lessonforge-frontend:container-audit
```

The marked-image build can reuse the previously completed build layers; excluded
markers do not change their inputs. Run the Python scanner from the backend audit
above again with these two substitutions: pass `"$lfcc_frontend_audit"` as its
argument, and set `marker = b'LESSONFORGE_SYNTHETIC_FRONTEND_EXCLUSION_MARKER'`.
It must inspect the effective context, image configuration and **all** final-image
layers, including files deleted in later layers. This demonstrates exclusion of
these synthetic samples, not a general secret audit. Keep the temporary export
for review. It represents this slice's unchanged committed frontend application
source plus its Docker/configuration edits; revisit the export if source changes.

## Verification record — 2026-11-09

- Exact Debian Node tag availability and multi-platform digest: verified through
  Docker Hub's metadata endpoint after sandbox DNS restrictions required a retry
  with network permission. This is registry evidence, not a successful image pull.
- Docker execution: blocked. The executable found through Windows printed
  `The command 'docker' could not be found in this WSL 2 distro.` and recommended
  enabling Docker Desktop WSL integration. A permitted retry had the same result;
  `/var/run/docker.sock` and native Linux Docker CLI/plugin were absent.
- Image build, final runtime user/dependency assertions, effective-context/layer
  audit, fixture startup/root response, negative startup checks and SIGTERM timing:
  **not executed** because Docker was unavailable. No fixture resources were created.
- Static verification: the YAML passed the official Compose JSON Schema and
  assertions for the isolated project/database, volume, loopback API publication,
  absent database publication/external attachments, build context, health dependency
  and local-only environment override. Dockerfile version/stage/runtime assertions,
  shell/JavaScript syntax checks, documented Bash/Python/JavaScript syntax, local
  documentation links, fixture ignore/example rules, formatting and whitespace
  checks passed. These do not validate Docker execution/interpolation or close any
  roadmap acceptance item. No application test suite was rerun; application source
  and dependency manifests are unchanged.

On a machine where Docker remains unavailable, enable Docker Desktop's WSL
integration for this distribution, reopen the terminal if needed, and check both
Docker commands again. Then run configuration, build,
startup, failure, shutdown and exclusion checks above in order. Build/run checks
sequentially on the 8 GB Windows/WSL2 machine; avoid simultaneous frontend builds,
rendered browser suites and database tests. No dependency installation, migrations
or provisioning command is needed on the host for this slice.

Future migrations require a separately reviewed operation with tooling, explicit
target configuration and migration credentials. The existing account CLI still
permits only its acknowledged development target and cannot provision this fixture
stack; its safeguards are unchanged. Later staging needs separate credentials,
data, roles and operational verification, not reuse of this local volume.

## Verification record — 2026-11-10 (latest)

This run supersedes the earlier Docker-access blocker, without changing the
historical 2026-11-09 record or closing roadmap acceptance gaps. All image builds
and heavy checks ran sequentially on Linux/amd64.

| Check                                 | Actual result                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Execution environment                 | Docker Client/Engine 29.8.2, Docker Desktop 4.95.0 and Compose v5.6.0 accessible. The sandbox initially denied `/var/run/docker.sock`; a permitted execution outside the sandbox succeeded.                                                                                                                                                                                            |
| Fixture configuration                 | No fixture containers/network/volume or fixture environment file existed at preflight. Created a new ignored `.env.container-check` with an owner-only fixture password; no development configuration was read. Quiet Compose validation and explicit missing-value rejection passed.                                                                                                  |
| Image build                           | Passed with the pinned Node 24.21.0 Debian image and locked installation. Prisma generation and Nest compilation actually ran with networking disabled, before any fixture database existed. The corrected build reused those unchanged layers.                                                                                                                                        |
| Packaging correction                  | The first runtime probe detected Prisma CLI retained as an optional peer despite dev pruning. Changed pruning to `--omit=dev --omit=optional` and added a final-stage rejection assertion; rebuilt and reran the complete runtime probe successfully. No manifest or lockfile changed.                                                                                                 |
| Final runtime                         | User `node`, UID 1000, Node `v24.21.0`, direct `["node","dist/main.js"]` command, production defaults and ESM metadata verified. Generated Prisma client/adapter imports, PostgreSQL compiler WASM compilation and an ephemeral Argon2id hash/verify passed with networking disabled. Compiled API/maintenance entry points existed; `.env`, Prisma CLI and migration SQL were absent. |
| Fixture startup and HTTP              | PostgreSQL became healthy before API startup; both services became healthy. Host `http://localhost:3101/` returned HTTP 200 and exactly `LessonForge API`.                                                                                                                                                                                                                             |
| Authenticated connectivity and schema | A Prisma query inside the API container returned the expected fixture database/role and `SELECT 1` result. A separate fixture catalog query returned zero public tables. No migrations or provisioning were run.                                                                                                                                                                       |
| Resource isolation                    | API attached only to `lessonforge-container-check_default`; PostgreSQL had no host bindings and used `lessonforge-container-check_postgres_data`. API publication was only `127.0.0.1:3101:3001`.                                                                                                                                                                                      |
| Negative startup                      | Missing database configuration, wrong fixture password, unavailable database with networking disabled, and production-mode implicit HTTP each exited 1 with the expected sanitized message. The helper also rejected database URLs and known synthetic password strings in output. No running service or database was reconfigured for these checks.                                   |
| SIGTERM                               | API stopped in **1.421 seconds** using a monotonic timer, exit 0, `OOMKilled=false`, no runtime error. Container events showed signal 15 and no signal 9; the 30-second grace period was not exhausted. This was an idle shutdown check.                                                                                                                                               |
| Synthetic exclusion audit             | Passed Docker's effective-context export and every saved audit-image filesystem layer plus configuration metadata. Synthetic markers in environment files, `.npmrc`, keys, logs, caches, host dependencies, builds and generated Prisma were absent. The audit source used the corrected Dockerfile and unchanged committed application source; its build reused verified layers.      |
| Cleanup                               | Removed only task-created fixture containers and network. Confirmed no project containers remained and the project-labelled fixture volume was retained. The ignored fixture password file was retained for that volume; no volume deletion or global cleanup was performed.                                                                                                           |

An additional startup-log-message assertion failed: both Compose logs and
direct container logs were empty with the `local` logging driver configured. This
does not establish that the logging driver caused the missing output. No log-message
success is claimed, and no application logging code was changed. Startup evidence
instead consists of the implemented pre-listen connectivity gate, successful root
response, direct authenticated Prisma query and rejected wrong-credential startup.
Useful operational logging remains separate staging work. The unchanged bootstrap
disables Nest logging during configuration/connectivity initialization and attempts
to enable it afterward; that source code alone is not evidence of captured logs.
Missing successful-startup logs do not invalidate the independent local startup
checks, but they leave observability unverified. Before opening restricted staging,
verify useful sanitized startup/listen, operational failure and shutdown output in
the deployed log collection path, without credentials, tokens or lesson content,
alongside real readiness checks and the failure procedure required by
[architecture](architecture.md#9-verification-and-delivery). The root health check
is not a substitute. This PR neither changes logging nor closes that staging item.

The corrected pruning step's automatic npm audit reported **four findings: one
moderate and three high**. The final review below investigates the locked packages
and advisories; no dependency remediation was performed. The earlier rejected
image reported nine findings before optional tooling was removed. Neither result
establishes dependency security or staging readiness.

No container execution blocker remains from this run. Windows-browser localhost
forwarding, active-hashing/in-flight-work shutdown latency, ongoing readiness,
authentication/workflow acceptance, HTTPS and all remaining staging/roadmap checks
remain outside this evidence. Application source and authentication/provisioning
safeguards are unchanged; no application test suite was rerun for this packaging
correction. Formatting, documented command syntax, local links and whitespace were
checked after the documentation update.

## Backend final review — 2026-11-10 (historical scope)

### Audit triage, highest severity first

The retained corrected-build log reports four **package findings**, not four
independent vulnerabilities. An isolated manifest/lockfile-only `npm audit
--omit=dev --omit=optional --json` attempt failed with registry DNS `EAI_AGAIN`;
no fresh npm audit success or exact `fixAvailable` result is claimed. The mapping
below reconciles the reported count with the locked versions and published GitHub
advisories. Final-image presence was checked against the dependency manifest in the
previously saved corrected audit-image layers (135 packages), not inferred solely
from the root lockfile. No container checks were rerun.

| npm severity / affected package              | Locked dependency path; advisory                                                                                                                                                                                                                                                 | Final runtime and applicability                                                                                                                                                                                                                                                                                                                                                   | Available fix and compatibility                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **High — `body-parser@2.3.0`**               | `backend -> @nestjs/platform-express@12.1.2 -> express@5.2.1 -> body-parser`. [GHSA-27r3-jxmh-p828 / CVE-2026-111181](https://github.com/advisories/GHSA-27r3-jxmh-p828): trailing bytes after a compressed body can produce an unhandled decompressor error and terminate Node. | **Present and relevant.** `configureAuthHttp` installs `express.json` parsers with default inflation enabled. Unsafe methods have Origin/CSRF gates, but those are not authentication or a general decompression mitigation; body parsing also runs on safe methods with bodies. Byte limits and a successful ordinary GET do not prove this crash path safe. No exploit was run. | Upgrade to `body-parser >=2.4.0` (the 1.x fix is `1.20.9`, not the appropriate branch here). `2.4.0` satisfies Express's `^2.2.1` range, so a reviewed transitive lock refresh can fix it without a major upgrade. Disabling inflation is an alternative application behavior change if compressed bodies are not supported. Neither was done; regression-test compressed/malformed bodies before staging.                                                   |
| **High — `multer@2.4.0`**                    | `backend -> @nestjs/platform-express@12.1.2 -> multer`. [GHSA-q7qp-rjg7-q26m / CVE-2026-113872](https://github.com/advisories/GHSA-q7qp-rjg7-q26m): an async `fileFilter` callback resuming after teardown can crash Node.                                                       | **Present**, not build-only. No upload interceptor, Multer middleware or async `fileFilter` is configured in application source; unsafe non-JSON bodies are rejected. The advisory's required feature is not currently enabled, rather than the package being absent or universally safe.                                                                                         | Fixed in `multer >=2.5.0`; synchronous filtering is the advisory workaround. Nest `12.1.2` pins `2.4.0` exactly, so a plain transitive lock refresh cannot cross that pin. A reviewed Nest adapter update or tested override is needed.                                                                                                                                                                                                                      |
| **High — `@nestjs/platform-express@12.1.2`** | Direct dependency; inherited finding from its exact `multer@2.4.0` dependency above. This is a **metavulnerability**, not a fourth independent advisory.                                                                                                                         | **Present**; same upload/async-filter applicability as the Multer row. Its presence does not demonstrate an active upload vulnerability in this API.                                                                                                                                                                                                                              | A verified released example is [Nest `12.4.1`](https://github.com/nestjs/nest/blob/v12.4.1/packages/platform-express/package.json), which uses `multer@2.5.0` and `express@5.3.0`. It is within the declared `^12.0.1` range, not a required major migration, but review coordinated Nest package versions, Express changes and regression tests. This is not a claim that `12.4.1` is the minimum fixed version or that every advisory is thereby resolved. |
| **Moderate — `qs@6.16.0`**                   | `backend -> @nestjs/platform-express -> express -> qs`, also `express -> body-parser -> qs`. [GHSA-6pq8-jhm2-2vcw / CVE-2026-110816](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw): comma-format serialization of attacker-shaped array elements can throw.                 | **Present**. The reported sink is `qs.stringify(..., { arrayFormat: 'comma' })`, not parsing alone. No such serialization path was identified in application source; Express query parsing alone does not establish exploitability. Whether an exception crashes a process also depends on its error boundary.                                                                    | Fixed in `qs >=6.16.1`; that patch fits Express's `^6.14.0` and body-parser's `^6.15.2` ranges. A reviewed lock refresh is compatible by semver, but still requires regression checks. The advisory text retains older “no fix” wording; its updated affected range and fix-status section identify `6.16.1`.                                                                                                                                                |

Build-only findings must be separated from those four runtime findings. The full
build retains dev tooling for compilation, including
`prisma -> @prisma/config -> deepmerge-ts@7.1.5`
([GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), high,
recursive-object stack exhaustion; fixed in `8.0.0`) and
`prisma -> mysql2@3.15.3`
([GHSA-3f6p-5ww8-9rcr](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr), high,
cleartext authentication downgrade; fixed in `3.22.0`, and
[GHSA-rgwj-5xj2-c3m3](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3), moderate,
compressed-protocol decompression exhaustion; fixed in `3.23.1`). These paths and inherited Prisma
findings are **not** final API-image packages: `prisma`, `@prisma/config`,
`deepmerge-ts` and `mysql2` are absent there. Build tools still deserve independent
maintenance; trusted non-recursive build configuration and offline generation do
not prove all build-time advisories inapplicable. Prisma pins these transitive
versions, so do not assume a patch-only lock refresh fixes them or force a major
`deepmerge-ts` replacement without a compatible Prisma update and generation tests.
This is not a complete triage of the earlier full-build or rejected-image counts.

### Scope and recommendation

The final diff is confined to `backend/Dockerfile`, `backend/.dockerignore`,
`compose.container-check.yaml`, `.env.container-check.example`, this guide and
the development-setup cross-link. It adds no frontend container, CI/deployment,
application/dependency changes, migration, provisioning or development-data access.
The isolated fixture, non-root runtime, explicit context, compiled direct startup,
CLI exclusion assertion and recorded smoke evidence match this local packaging
scope. Missing success logs are a local verification limitation, not permission
to waive staging observability.

**Recommendation: ready to commit this scoped local-containerization PR, not ready
to deploy or open staging.** No newly introduced packaging blocker was identified.
The unchanged dependency baseline has the runtime security follow-ups above;
prioritize the relevant compressed-body issue and verify remediation in a separate
dependency/application PR before staging. Do not describe pruning or the smoke
checks as a clean security audit. Reconfirm the exact npm JSON mapping when registry
access is available; no `npm audit fix`, dependency installation, repository lockfile
edit, application edit or Git mutation was performed for this review.

## Frontend slice verification — 2026-11-10

Implemented on `feat/frontend-containerization`. Preflight found only an existing
uncommitted `backend/Dockerfile` comment/whitespace edit; it was preserved. The
fixture password file and named volume from the earlier backend checks were reused,
without reading development environment files. No containers were present before
this task started. Commands used the explicit `lfcc` project/file/environment
selection described above; the verification scripts are reproduced in this guide.
Temporary evidence/source exports are under `/tmp/lessonforge-frontend-check/`.

| Check | Actual result |
| --- | --- |
| Docker/base | Client/Engine 29.8.2, Compose v5.6.0 accessible with permission outside the sandbox. Registry inspection reconfirmed Node 24.21.0 and its pinned multi-platform digest. Executed Linux/amd64 only. |
| Sequential builds | API succeeded using existing verified build layers, then frontend locked Linux installation and production build succeeded. Frontend compilation ran with `--network=none`, with no API/database running; all routes compiled/generated. No duplicate host production build. |
| Runtime/native dependencies | Image user `node`, UID 1000, Node v24.21.0, production environment, 0.0.0.0:3000 and direct Node command verified. Standalone server/static/public paths and absence of root environment files checked. A Sharp create/PNG encode succeeded without networking; successful build also exercised the Linux build dependencies. |
| Independent startup | Frontend alone became healthy and served `/sign-in` before API/database startup. Frontend logs included the standalone ready/listener output. |
| Isolated stack | All three services became healthy. UI/API bound only to 127.0.0.1 ports 3100/3101, database unpublished, all attached only to the fixture network, database using the retained fixture volume. Read-only fixture identity/catalog query returned `lessonforge_container_check` database/role and **0 public tables**. No migration, provisioning or development database access. |
| HTTP/assets | `/sign-in` returned HTML 200; all **8** referenced generated CSS/JS files returned 200 with appropriate content types and nonempty bodies. `/file.svg` and `/favicon.ico` returned 200 with source-matching bytes. |
| Unauthenticated API/CORS | Cookie-free `/auth/me` returned 401 and `Authentication required.`. Allowed UI origin received exact allow-origin, credentials true and Vary: Origin. Login OPTIONS returned 204 allowing POST, Content-Type and X-LessonForge-CSRF. Development UI port 3000 and an untrusted origin received no allow-origin on reads/preflights. These are HTTP/header observations. |
| Real browser | Existing Playwright/Chromium **156.0.8078.4**, headless with fresh context and no response interception: `/sign-in`, `/drafts`, `/library`, `/admin/reviews` rendered sign-in with no authenticated navigation/editor controls. Show password state changes and computed CSS verified hydration/interactivity. **5 actual GETs** to `http://localhost:3101/auth/me` returned 401, including an explicit `credentials: "include"` fetch whose body JavaScript could read. No page errors or hydration warnings observed. No login POST or account creation. |
| Sandbox/timeouts | Initial host network check failed with sandbox `EPERM`; permitted execution succeeded. The first permitted multi-request HTTP probe hit its 10-second timeout; targeted UI/API checks then succeeded. The complete HTTP/browser probe passed with a 30-second diagnostic deadline. This is no performance guarantee. Windows-host browser forwarding was not checked. |
| Synthetic audit | **28** synthetic samples absent from Docker's effective frontend context, saved image configuration and **all 9 final-image layers**. Audit build reused verified compilation/install layers. No real secret values were used in the audit. |
| Frontend SIGTERM | **6.015 seconds** measured with a monotonic timer around Compose stop, exit **143**, no OOM/runtime error; Docker events recorded signal **15**, no signal 9. Within the documented **30-second** grace period. Idle check only. |
| API shutdown/cleanup | API stopped in **2.444 seconds**, exit 0, no OOM/runtime error, signal 15 only. Removed only task-created fixture containers/network. Confirmed no project containers remained; fixture volume and ignored configuration retained. |
| Frontend checks | ESLint passed, `next typegen && tsc --noEmit` passed, **152/152** existing request/state tests passed. Production image build passed. Existing intercepted-API rendered suite was not rerun; real unauthenticated container browser evidence is above. |
| Diff/documentation | Scoped `git diff --check` passed. Full `git diff --check` reports only the two pre-existing trailing spaces in `backend/Dockerfile` (lines 22 and 27); left untouched. Documented Bash/JS/Python syntax and local file links checked. No dependency manifest/lockfile or Git staging/branch mutation. |

The frontend full **builder** install reported **9 npm findings: 7 moderate,
1 high, 1 critical**, plus an ESLint deprecation and an unapproved optional tooling
postinstall notice for `unrs-resolver`. The build succeeded. These counts are not a
runtime-image audit; the final review below separates package presence from
advisory applicability. No automatic remediation, dependency upgrade or lockfile
change was performed. Carry forward
the backend runtime/build audit triage and sanitized operational logging follow-ups
in the historical backend review above. The API still produced no success logs in
this run; frontend logs do not close backend observability work.

These results establish local packaging and unauthenticated transport only.
Authenticated workflows, real session-cookie attributes, authenticated CSRF,
application-table access, other browsers, full accessibility, Windows browser
forwarding, shutdown under load, deployed HTTPS/security and staging readiness
remain unverified by this slice. The fixture stays unmigrated and unsuitable for
workflow acceptance. No hosting, CI expansion, AI, migration, provisioning or
production authentication change is included. No commit, push, merge, branch
switch or deployment was performed.

## Frontend final review — 2026-11-10

### Scope and backend independence

The pre-existing `backend/Dockerfile` diff relative to HEAD adds five comments:
system-library installation, Node dependency installation/building, source/config
copying, dependency removal, and the final runtime stage. It also adds one trailing
space to each of the existing sequential-pruning and Argon2 comments (current lines
22 and 27). This is **comments and whitespace**, not whitespace alone, but contains
**no functional change**: all non-comment Dockerfile instructions match HEAD.
The frontend verification's API build used this working-tree Dockerfile, reusing
verified layers. The frontend image/build and its independent startup do not depend
on these edits; the API behavior is identical with HEAD's Dockerfile. The backend
diff was inspected only, not reverted, formatted or included in the frontend scope.

### Dependency triage and evidence limits

An isolated copy of the frontend manifest/lockfile was used for `npm audit
--package-lock-only --json`, with empty user/global npm configuration, a temporary
cache, the public registry, no retries and a 15-second fetch timeout. It failed with
registry DNS **`EAI_AGAIN`**, not a completed security report. Fresh registry
confirmation, exact historical npm metavulnerability keys and `fixAvailable`
values are **unavailable**. The original nine-finding aggregate is retained; it is
not nine independent advisories. The following is a **lockfile/public-advisory
reconstruction**, not recovered builder audit JSON. The seven moderate candidate
keys account for the Minimatch lint-tool cascade; their exact npm attribution
(including whether an outer ancestor is counted instead) remains unconfirmed.

Presence was inspected without Docker execution using the retained
`/tmp/lessonforge-frontend-check/audit/image.tar`: all nine runtime layers, 256
package manifests including base tooling (70 under `/app`). No whiteouts were
present. The saved audit input's Dockerfile, Next configuration and lockfile match
the reviewed files; the earlier audit reused the verified build layers. This is
evidence from that saved Linux/amd64 audit image, not a fresh scan of every tag,
platform, OS library or vendored dependency. Review artifacts, inventory and failed
audit output are retained in `/tmp/lessonforge-frontend-review/`.

| Severity / package | Locked dependency path and advisory | Standalone application / exposure | Fix and compatibility |
| --- | --- | --- | --- |
| **Critical — `next@16.3.8`** | `frontend -> next`. [GHSA-673q-mjm6-r5xr](https://github.com/advisories/GHSA-673q-mjm6-r5xr) (`use cache` typed-array RCE); [GHSA-2464-fhr4-w9xw / CVE-2026-96889](https://github.com/advisories/GHSA-2464-fhr4-w9xw) (glibc SVG/image RCE); also **high** [GHSA-p3m5-59mp-jv5r / CVE-2026-94482](https://github.com/advisories/GHSA-p3m5-59mp-jv5r) (Server Actions CPU DoS). One package can aggregate several severities. | **Present at runtime**, not build-only. No `use cache`, Cache Components configuration or Server Actions were found in this app, so those stated prerequisites are not enabled. The glibc image retains `sharp@0.35.5` and its Linux/libvips packages: it already meets the SVG RCE advisory's explicit Sharp workaround. This is not a general Next.js security clearance or an exploit test. | Those October advisories name `16.4.1` as fixed, but the later November release requires **`16.4.5`** for the issues below. Updating the exact Next pin is a reviewed **minor**, not major, upgrade; coordinate the exact `eslint-config-next` pin, rebuild and regression-test routing, hydration, assets and transport. Merely refreshing Sharp or setting runtime environment variables does not patch Next's bundled RSC code. |
| **High — `zod@4.6.5`** | `frontend -> eslint-config-next@16.3.8 -> eslint-plugin-react-hooks@7.1.1 -> zod`. [GHSA-mrhx-c7xc-m3w5 / CVE-2023-54404](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5): excessive validation work/issue allocation for oversized collections. | The **locked 4.6.5 package is absent** from `/app/node_modules/zod`; it is lint/build-environment tooling, not the application's API validation layer. **Caveat:** Next retains a separate, unversioned `next/dist/compiled/zod` bundle. Its exact version and advisory applicability are unresolved; do not claim that all Zod code is absent or that a top-level lock refresh fixes this vendored copy. | `zod >=4.6.6` fixes the published range. A 4.x patch fits the hooks plugin's `^3.25.0 || ^4.0.0` range and needs lint/tooling regression checks, not a forced Zod major migration here. Vendored code requires separate framework provenance/remediation review. |
| **Moderate — `minimatch@10.2.6`** | `frontend -> eslint-config-next -> typescript-eslint@8.71.0 -> @typescript-eslint/typescript-estree@8.71.0 -> minimatch` (nested under typescript-estree). [GHSA-g3hv-75wg-m249 / CVE-2026-118764](https://github.com/advisories/GHSA-g3hv-75wg-m249): pattern amplification with `optimizationLevel >= 2`; current reviewed range `>=7.0.0 <11.0.1`. | The app's **10.2.6 copy is absent**, but see the base-image **10.2.5** copy below. Build/lint applicability requires attacker-controlled patterns and the specified optimization mode. The inspected typescript-estree call passes only `{ dot: true }`, leaving default optimization level 1. This is a scoped applicability observation, not a blanket build-tool exemption. | Fixed in `11.0.1`; outside typescript-estree's `^10.2.2` range. A routine lock refresh cannot cross that major boundary. Prefer compatible upstream tooling updates; any targeted override needs explicit API/Node-engine and lint/typecheck testing. Do not globally replace the unrelated CommonJS `minimatch@3.1.5` consumers with 11.x. |
| **Moderate candidate — `@typescript-eslint/typescript-estree@8.71.0`** | `frontend -> eslint-config-next -> typescript-eslint -> typescript-estree -> minimatch`; inherited GHSA-g3hv-75wg-m249, not a new advisory. | **Absent** from runtime; same build/lint conditions as above. | Requires a compatible parent/tooling release or deliberately tested override of its Minimatch dependency; no verified current npm fix suggestion available. |
| **Moderate candidate — `@typescript-eslint/parser@8.71.0`** | `frontend -> eslint-config-next -> typescript-eslint -> parser -> typescript-estree -> minimatch`; same inherited advisory. | **Absent** from runtime; same build/lint conditions. | Same coordinated tooling remedy, respecting the family's exact internal version dependencies. |
| **Moderate candidate — `@typescript-eslint/type-utils@8.71.0`** | `frontend -> eslint-config-next -> typescript-eslint -> eslint-plugin -> type-utils -> typescript-estree -> minimatch`; same inherited advisory. | **Absent** from runtime; same build/lint conditions. | Same coordinated tooling remedy. |
| **Moderate candidate — `@typescript-eslint/utils@8.71.0`** | `frontend -> eslint-config-next -> typescript-eslint -> utils -> typescript-estree -> minimatch`; same inherited advisory. | **Absent** from runtime; same build/lint conditions. | Same coordinated tooling remedy. |
| **Moderate candidate — `@typescript-eslint/eslint-plugin@8.71.0`** | `frontend -> eslint-config-next -> typescript-eslint -> eslint-plugin -> type-utils/utils -> typescript-estree -> minimatch` (also a parser peer path); same inherited advisory. | **Absent** from runtime; same build/lint conditions. | Same coordinated tooling remedy. |
| **Moderate candidate — `typescript-eslint@8.71.0`** | `frontend -> eslint-config-next -> typescript-eslint -> typescript-estree -> minimatch`; same inherited advisory. | **Absent** from runtime; same build/lint conditions. | Same coordinated tooling remedy; do not assume a Next framework update alone removes this cascade. |

The base image retains **`npm@11.19.0 -> minimatch@10.2.5`**, also through
`npm -> glob@13.0.6 -> minimatch`. It falls inside GHSA-g3hv-75wg-m249's affected
range and is physically present at
`/usr/local/lib/node_modules/npm/node_modules/minimatch`. This is **runtime-image
tooling exposure**, distinct from an HTTP application dependency: the direct
`node server.js` command does not invoke npm/glob. Running that CLI later with
untrusted patterns can change applicability. Consider a reviewed base-image/npm
update or runtime tooling removal separately; the frontend lockfile cannot patch
this base-image copy. No base change or CLI exploit was performed.

Public vendor evidence also identifies the **November 3 Next.js advisories**.
These belong to the same Next package, not extra npm package-count findings:

| Advisory (moderate in the linked vendor advisory) | Presence/applicability and fix |
| --- | --- |
| [GHSA-mfr8-8qww-v76h](https://github.com/vercel/next.js/security/advisories/GHSA-mfr8-8qww-v76h), [GHSA-vc7v-qv4w-wrv8](https://github.com/vercel/next.js/security/advisories/GHSA-vc7v-qv4w-wrv8), [GHSA-rhh4-g77r-r9qj](https://github.com/vercel/next.js/security/advisories/GHSA-rhh4-g77r-r9qj) | `next@16.3.8` is in their ranges. Cache/root-param/binary-argument disclosure or poisoning requires `use cache` features absent from this source/configuration. Fixed in `16.4.5`. The release blog labels the first issue high, whereas its vendor advisory labels it moderate; preserve that source distinction. |
| [GHSA-pc58-hwjq-p385 / CVE-2026-119348](https://github.com/vercel/next.js/security/advisories/GHSA-pc58-hwjq-p385) | Affected Next version present; requires forwarding fetched responses unchanged plus a pipelining HTTP/1.1 reverse proxy. This slice has no route handlers/proxy or server-side API forwarding. Fixed in `16.4.5`. |
| [GHSA-f3mh-rxg3-f5g2](https://github.com/vercel/next.js/security/advisories/GHSA-f3mh-rxg3-f5g2) | Affected Next version present; requires sensitive cookies set with NextResponse on Edge routes. This app has no such routes; Nest owns session cookies. Fixed in `16.4.5`. This does not verify real authenticated cookie security. |
| [GHSA-7qx7-33qx-rqx2](https://github.com/vercel/next.js/security/advisories/GHSA-7qx7-33qx-rqx2) | **Runtime code/version present**: `/_next/image` SVG-rejection bypass requires attacker-supplied image bytes from an allowed source. No remote image patterns, upload capability or `next/image` use was found; that limits identified inputs but does not prove the optimizer endpoint unreachable. **Applicability remains conditional/unverified**, even with the separate SVG RCE workaround satisfied. Fixed in `16.4.5`. |
| [GHSA-vvgp-ww4w-46vf](https://github.com/vercel/next.js/security/advisories/GHSA-vvgp-ww4w-46vf) | Range starts at `16.4.0`, so **16.3.8 is outside it**. Relevant when selecting an upgrade: fixed in `16.4.5`, not merely `16.4.1`. |

See the [vendor's November security release](https://nextjs.org/blog/november-2026-security-release).
The old local npm cache also contains the braces stack-exhaustion advisory
[GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
and inherited `micromatch`/`fast-glob`/Next ESLint findings. The public advisory was
**withdrawn on October 23** as not practically exploitable; do not substitute those
stale high-severity cache entries for the recorded current nine. No audit
suppression, automatic fix, installation, package upgrade or lockfile edit was made.

### Shutdown confirmation and recommendation

The existing `shutdown-results.json` and its `stop-check.py` record frontend stop
time **6.015 seconds**, exit **143** (`128 + SIGTERM`), `oomKilled: false`, empty
runtime error and signals **[15]**, with no signal 9. This supports idle termination
within the 30-second grace period **without forced SIGKILL or OOM**, not exit 0 or
in-flight request draining. Evidence was sufficient; shutdown was not rerun.

**No newly introduced frontend packaging commit blocker was identified.** The
dependency baseline is unchanged and is not a clean security audit: prioritize the
Next update and resolve the conditional/vendored/base-tooling boundaries before
staging. The local loopback containerization slice is not deployment approval.
Authenticated workflows, HTTPS/cookie/CSRF security, readiness, useful backend logs
and all previously open staging gaps remain open. Passed build, browser, native,
lint, typecheck, test and container checks were not repeated for this final review.

The exact frontend commit scope is **`frontend/Dockerfile`,
`frontend/.dockerignore`, `frontend/next.config.ts`, `compose.container-check.yaml`,
`docs/containerization.md`, and `docs/development-setup.md`**. Exclude the
pre-existing `backend/Dockerfile` diff. `.env.container-check.example`, manifests,
lockfiles, development infrastructure and application source are unchanged. Only
this guide was edited during the final review; no staging, commit, push, merge,
branch switch, deployment or development-resource mutation was performed.
