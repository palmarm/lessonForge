# LessonForge frontend authentication verification

## Scope

Step 3 of [authentication design](authentication-design.md) implements the
Tailwind login form, browser API helper, current-user context, and logout.
NestJS remains authoritative for credentials, sessions, and permissions; its
endpoint contracts, configuration, cookies, and database behavior are unchanged.

`src/app/page.tsx` and the root layout remain Server Components. Their public
shell contains no identity lookup, cookie forwarding, or personalized server
cache. After mounting, the Client Component provider calls `GET /auth/me` once
(development Strict Mode can mount effects twice). There is no background polling
or client-side expiry policy. Identity stays in memory; a refresh restores it from
NestJS. No passwords, tokens, or identity are written to browser storage.

The helper accepts only a fixed, canonical `NEXT_PUBLIC_API_BASE_URL` origin:
HTTPS or HTTP loopback, without user information, path, query, fragment, or trailing
slash. Configuration is public and embedded by Next.js at build time. Requests
use fixed `/auth/me`, `/auth/login`, and `/auth/logout` routes,
`credentials: include`, `cache: no-store`, and `redirect: error`. Writes use JSON
and `X-LessonForge-CSRF: 1`. JavaScript neither reads session cookies nor sets a
bearer header. Success responses must match the backend's exact safe-user shape,
known roles, UUID identity, and serialized expiry; logout must return 204.
Unknown/malformed responses produce safe errors rather than authenticated state.

The context exposes loading, authenticated, unauthenticated, and error states,
plus pending login/logout. The form has visible labels, username/current-password
autocomplete, keyboard focus outlines, live status/error messages, and disabled
controls during submission. Password state is cleared when submission begins,
including failed attempts. Email remains available for retry. The UI displays
only the last confirmed account name/role and a logout action; role display grants
no access to backend operations.

Confirmed 401 clears identity. A successful logout clears identity; network,
503, rejected, and malformed logout responses retain the last confirmed account
with an explicit unconfirmed-logout error and retry. Request generations prevent
earlier identity reads from overwriting newer login/logout outcomes. Cookie-changing
requests cannot overlap, since discarding their response in React would not undo
a browser `Set-Cookie`. Effect cleanup invalidates earlier identity reads while
allowing accepted cookie changes to settle across an effect remount.

Authentication requests have one 15-second deadline covering fetch headers,
complete success-body consumption, and response validation. Timeout aborts the
transport and rejects as an availability error, even if a transport/body reader
ignores abort. The timer and any caller cancellation listener are removed on all
completion paths; failed responses' unread bodies are aborted. Optional caller
cancellation is preserved as cancellation, distinct from timeout or 401.
Initial timeout leaves loading and offers Check session again. Uncertain logout
retains identity and permits retry. Login timeout explicitly says sign-in may
have completed: no automatic retry or credential-rejection claim is made, and
Check session again reconciles through `/auth/me`. Late completions cannot
overwrite a newer state. The existing effect cleanup and mutation exclusion remain.

## Initial step-3 automated checks on 2026-10-14

Checks run with installed Node 24.21.0 in an isolated frontend copy under `/tmp`,
excluding real `.env*` files and previous `.next` output. Dependencies are reused
from the existing installation; no packages are installed. No backend process or
database is started, and fetch is mocked in tests. The public fixture origin is
`http://localhost:3001`. No teacher/admin password or successful development
login is part of this evidence.

| Check | Result |
|---|---|
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm test` | 21 passed: 8 API and 13 session cases |
| `npm run build` (default Turbopack) | Blocked by this environment's internal port-bind restriction after escalation |
| `npm run build -- --webpack` | Passed on final source with expanded permissions; root and not-found pages prerendered as static content |
| Prerendered root HTML | Public shell/loading state; no authenticated fixture identity |
| `git diff --check`, new-file whitespace, and local documentation links | Passed |

The first isolated build refused an external dependency symlink; replacing it
with copied entries from the existing installed packages resolved that isolation
issue. The sandboxed default build then could not fetch the existing Google
Fonts. A permitted retry fetched fonts but hit Turbopack's internal PostCSS port
bind with `Operation not permitted`. The default build script remains unchanged.
The Webpack production build passed with expanded permissions. A sandboxed
repeat could not parse a TypeScript subprocess result; the final-source permitted
repeat passed compilation, TypeScript, prerendering, and build tracing with exit 0.
Failed attempts do not count as passing evidence. The verification copy matched
all changed implementation/configuration/test files; its temporary artifacts were
removed after checks.

The API cases cover destination rejection before fetch, fixed credentialed routes,
CSRF/JSON writes, preservation of submitted password whitespace, safe response
projections, both roles, malformed bodies/dates/roles/extra credentials, expected
success status/content type, 401/403/429/503/network errors, and logout's exact
204 contract. Session cases cover initial identity restoration, confirmed 401,
availability failures and retry, pending login, invalid credentials, failed and
successful logout, stale read success/401 after newer actions, mutation exclusion,
effect cleanup/repeated mounts (including a pending login), and subscription cleanup.

Tests use Node's built-in runner with native TypeScript stripping, in one process
without global mocks or shared mutable fixtures. No new test packages are needed.
The API/session tests do not exercise a real browser, rendered form interactions,
assistive technology, browser cookie enforcement, or actual credentialed CORS.
The detailed browser checklist below includes the separately reported developer
results; checks beyond those confirmed outcomes remain pending.
These local checks do not establish a new GitHub Actions run or deployment result.

## Deadline follow-up verification

The follow-up adds deterministic Node mock-timer tests for stalled headers,
streaming bodies that never finish, the shared 15-second deadline, successful
body completion, cancellation, timer/listener disposal, timeout recovery, uncertain
logout, login reconciliation without automatic retry, and late success/failure
after a newer state or effect mount. Fetch is mocked and no database is used.
The earlier loading incident subsequently resolved; its cause is not established.
This change addresses a reproduced indefinite-request path and does not establish
the cause of that incident.

Follow-up checks use Node 24.21.0 and an isolated frontend copy at
`/tmp/lessonforge-auth-deadline-2ib9tqzc/frontend`, excluding real `.env*` files,
previous build output, and dependencies before copying entries from the existing
installed packages. No packages are installed. The tests also passed directly
against source with Node's runner, which does not load environment files. No API
process or database is used. The initial 21-test/build evidence above is historical.

| Follow-up check | Result |
|---|---|
| Frontend tests | 33 passed: existing 21 plus 12 deadline/cancellation/recovery cases |
| Frontend lint | Passed |
| `npm run typecheck` | Passed |
| Changed-source Prettier check | Passed |
| `npm run build -- --webpack` | Passed with expanded permissions; compilation, TypeScript, static prerendering, and build tracing exited 0 |
| Default Turbopack build | Not rerun; the prior internal port-bind restriction remains recorded above |
| Whitespace and local documentation links | Passed |

The build retried the existing Google Fonts downloads before succeeding. Source
formatting passed, and changed implementation/test files matched the final
verification copy. The copy and its task-created path record were removed after
checks; repository dependencies were retained. No new browser results or GitHub
Actions run are claimed by this follow-up.

## Developer browser results on 2026-10-14

The developer confirmed these browser outcomes passed:

- Teacher and administrator login.
- Identity restoration after refresh.
- Logout.
- Incorrect-password rejection.

Only these reported outcomes are confirmed. API-outage recovery, cookie-attribute
inspection, CORS/CSRF enforcement/preflights, HTTPS behavior, component-rendering
tests, and keyboard/screen-reader interaction remain pending. No credentials,
cookie values, or unreported status codes are recorded.
This report predates the deadline follow-up and does not verify timeout recovery
in a browser.

## Confirmed browser outage recovery

The developer separately confirmed browser API-outage recovery. This confirmation
updates the earlier pending status above; it does not establish the cause of the
earlier loading incident or verify every timeout, 503, or failed-logout variant in
the checklist. No additional status codes or inspection results are claimed.

Cookie attributes, CORS/CSRF/preflights, HTTPS, component rendering, and
keyboard/screen-reader checks remain unverified. Local outage recovery is also
separate from verification on the eventual restricted staging deployment.

## Exact local startup

Use the existing configured and migrated development database and provisioned
accounts. From the repository root:

```bash
nvm use
cp -n frontend/.env.example frontend/.env.local
docker compose up -d --wait db
```

`nvm use` selects the project Node version. Copy creates public frontend
configuration only if the file is absent; it never overwrites existing settings.
Compose starts the existing PostgreSQL service and preserves its named volume.
Do not reset, recreate, or re-provision accounts for this browser check.

In one terminal, start NestJS with matching public local origins:

```bash
NODE_ENV=development PORT=3001 API_PUBLIC_ORIGIN=http://localhost:3001 AUTH_ALLOWED_ORIGINS=http://localhost:3000 AUTH_COOKIE_MODE=local-http npm run start:dev --prefix backend
```

This generates Prisma and starts the watch-mode API, using the existing ignored
backend database configuration. It checks connectivity before listening and does
not migrate or seed. The shell origins override file settings for this process.

In another terminal, start Next.js on the allowed browser port:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm run dev --prefix frontend -- --hostname localhost --port 3000
```

This starts the frontend watcher and embeds the public API address. Open exactly
`http://localhost:3000`; use `localhost` for the API too. Mixing `127.0.0.1` and
`localhost`, or switching UI ports, breaks the configured cookie/origin policy.
Stop each application with Ctrl+C when finished. Changing the API address needs
a development restart or a production rebuild.

To repeat frontend checks from the repository root:

```bash
npm run lint --prefix frontend
npm run typecheck --prefix frontend
npm test --prefix frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm run build --prefix frontend
```

Build writes `.next/` and requires network access for the existing Google Fonts
integration when uncached. It does not contact NestJS or PostgreSQL. When doing
agent verification without real environment access, use an isolated source copy
excluding `.env*`, as above; Next.js normally loads local frontend environment
files during its commands.

## Manual browser checklist

Basic login, refresh, logout, incorrect-password rejection, and separately reported
API-outage recovery are confirmed in the developer records above. Other assertions
within these checklist items remain **pending**, including inspection details
bundled with those flows. Use your provisioned account details privately. Record
roles, status codes, and outcomes only; do not share passwords, cookie values,
request bodies, or an unredacted Network export.

1. **Initial load and accessibility:** with no session, open `http://localhost:3000`.
   See the public heading, session loading message, and a login form after
   `/auth/me` returns 401. Tab through labeled email/password fields and Sign in;
   verify visible focus, username/current-password autocomplete, Enter submission,
   and announcement of pending status and errors. Check narrow-screen layout and
   browser zoom. The server document must not contain a personalized user.
2. **Teacher:** sign in with the provisioned teacher. Expect `POST /auth/login`
   200, teacher display name/role, and Sign out. Observe disabled controls and
   cleared password input as soon as submission starts. The successful JSON
   contains only safe user fields and expiry, with no token/hash/password.
3. **Refresh:** reload while signed in. Expect initial loading followed by
   `GET /auth/me` 200 restoring the same teacher. There must be no repeated
   background `/auth/me` polling. An expired/deleted browser session followed by
   refresh produces 401 and the login form.
4. **Logout:** click Sign out. Expect JSON `{}` to `/auth/logout`, HTTP 204,
   cleared cookie, and the login form. Refresh must yield `/auth/me` 401. Other
   browsers/devices remain signed in under the existing session policy.
5. **Administrator:** repeat login, refresh, and logout using the provisioned
   administrator. Expect its display name and Administrator role. No dashboard
   or domain authorization is inferred from that display.
6. **Invalid credentials and rejected writes:** use an incorrect password and
   a nonexistent email separately. Both must return 401 with the same visible
   `Invalid email or password.` error; password input is empty and email is
   retained. A 403 shows a blocked-request error; a 429 asks the user to wait.
7. **API unavailable:** use DevTools request blocking for
   `http://localhost:3001/*` and refresh. See an error and Check session again,
   rather than a confirmed signed-out state. Unblock and retry. While signed in,
   block the API and click Sign out: the last confirmed name/role remains,
   with `Sign out could not be confirmed` and retry. Unblock and retry logout;
   only success clears identity. If the API returns 503, verify the same retention
   behavior; this must never be treated as 401. Mocked 503 is already covered by
   the automated tests; record real browser 503 separately if exercised.
8. **Cookies and storage:** inspect the local `lessonforge_session` cookie:
   HttpOnly, SameSite=Lax, Path=/, no Domain attribute in `Set-Cookie`, and
   Secure absent only for local HTTP. Login sets an eight-hour Max-Age; logout
   expires the same cookie. `document.cookie` cannot read the session token.
   Local/session storage must contain no application passwords, tokens, or identity.
   Deployed HTTPS must use Secure `__Host-lessonforge_session`; deployment is
   outside this local check.
9. **CORS/CSRF:** inspect a credentialed login/logout preflight (clear the
   preflight cache if necessary): exact UI `Origin`, allowed methods,
   `Content-Type` and `X-LessonForge-CSRF`, exact `Access-Control-Allow-Origin:
   http://localhost:3000`, `Access-Control-Allow-Credentials: true`, and
   `Vary: Origin`. Actual writes must include `X-LessonForge-CSRF: 1` and JSON;
   subsequent `/auth/me` must include the browser cookie. From the UI's browser
   console, send a logout request without the CSRF header:

   ```js
   await fetch("http://localhost:3001/auth/logout", {
     method: "POST", credentials: "include",
     headers: { "Content-Type": "application/json" }, body: "{}",
   });
   ```

   Expect 403 without logout; refresh should still restore the valid account.
   A request from an unallowed UI origin must be blocked by credentialed CORS,
   and writes by backend origin enforcement. Do not add a wildcard origin to
   make the test pass. Current database-free backend HTTP tests provide separate
   evidence for rejected origins and missing CSRF headers.

## Remaining evidence

Actual cookie attributes/preflights, CORS/CSRF and HTTPS behavior, component
rendering, keyboard and screen-reader interaction, outage/timeout variants beyond
the separate confirmation above, and a GitHub Actions run containing these
frontend tests require developer verification. Backend deployment
origins, HTTPS, proxy trust, shared limiting, cleanup scheduling, and KDF performance
remain as documented in [backend verification](authentication-verification.md).
