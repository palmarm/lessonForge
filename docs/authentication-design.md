# LessonForge authentication and authorization plan

## Authority and status

This design was finalized on 2026-10-09. Step 1 (backend authentication) is now
implemented; [authentication verification](authentication-verification.md) records
actual checks and remaining gaps. Account provisioning and the Next.js interface
remain planned steps 2 and 3.
The [specification](project-specification.md), [architecture](architecture.md),
[domain design](domain-schema.md), and existing Prisma schema remain authoritative.
The confirmed authentication decision is PostgreSQL-backed opaque sessions in an
HttpOnly cookie, with only a hash of each random session token stored in the
database. NestJS owns authentication, authorization, and database access.

The existing six-model migration `20261008000000_initial_domain` is applied to
`lessonforge_dev`, as [confirmed by the developer](domain-schema-verification.md).
Do not edit that migration. The additive `20261009000000_add_sessions` migration
implements Session storage; application to the development database remains a
separate developer step. The API now exposes login/me/logout and default/role
guards. The Next.js page still has no login interface or API client. Provisioning,
seeding, ownership/workflow services, and AI remain pending.

Historical planning evidence: the earlier design task installed nothing, created
no migration, and did not read real environment files or access any database.
Backend implementation preserves that history; its isolated checks are recorded
separately.

## MVP defaults and implementation choices

The developer has adopted the expiry, concurrent-device, and current-session-only
logout policies below for the MVP. The other entries describe the technical
defaults used by step 1 and the recommended deployment topology. They keep one
role per account and add no registration, account-management
UI, password-reset service, school tenancy, or AI capability.

| Concern | Decision or recommendation |
|---|---|
| Login identifier | Existing canonical lowercase email; trim/lowercase at input. |
| Password hashing | Argon2id, 64 MiB memory, 3 iterations, parallelism 1, random 16-byte salt, 32-byte output; store the encoded hash. |
| Token | 32 random bytes encoded as unpadded base64url (43 characters); SHA-256 hash stored as 64 lowercase hex characters. |
| Absolute expiry | Adopted: eight hours from login, fixed; requests never extend it. |
| Idle expiry | Adopted: thirty minutes after the last session-valid authenticated request; sliding only within the fixed eight-hour limit. Subsequent authorization rejection still counts as activity. |
| Concurrent sessions | Adopted: allow separate browsers/devices. |
| Logout scope | Adopted: revoke the current (presented) session only; other devices remain signed in. |
| Local transport | Browser `http://localhost:3000` calls NestJS `http://localhost:3001` directly. PostgreSQL remains `127.0.0.1:5433`. |
| Deployment | HTTPS UI/API under the same registrable domain, with a host-only API cookie and explicit frontend origin. Hosting remains unselected. |

Argon2id is OWASP's preferred password KDF; its documented minimum is 19 MiB,
two iterations, and parallelism one. The stronger starting parameters above are
LessonForge choices and need benchmarking on the actual runner/host. Passwords
need a slow KDF; a high-entropy random session token can use SHA-256 for indexed
lookup. [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
and [Node 24 crypto APIs](https://nodejs.org/docs/latest-v24.x/api/crypto.html).

An absolute timeout bounds stolen-token lifetime; idle expiry reduces exposure
after an unattended browser. The tradeoff is a session write per authenticated
request and occasional reauthentication. Do not poll `/auth/me` in the background
to keep sessions alive. A future lesson editor must retain unsaved work when
authentication expires. [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Backend endpoints and credential handling

Use an `AuthModule` with a controller, authentication/session service, password
service, and guards using the existing Prisma service. Keep native Argon2 imports
behind the password service and retain ESM `.js` imports and current Prisma
generation/runtime configuration. Shared bootstrap configuration must also be
used by HTTP tests so they exercise the real cookie, CORS, and CSRF policy.

| Route | Authentication | Request and result |
|---|---|---|
| `POST /auth/login` | Explicitly public; CSRF and rate limits still apply | JSON `{ email, password }`. Return HTTP 200 with `{ user: { id, email, displayName, role }, expiresAt }`, plus the session cookie, after committing session creation. |
| `GET /auth/me` | Required | HTTP 200 with the same safe user projection and absolute `expiresAt`; otherwise generic HTTP 401. Never return token/hash/password hash. |
| `POST /auth/logout` | Explicitly public/idempotent; CSRF still applies | Empty JSON `{}`. Revoke the presented session if it exists, clear the cookie, and return HTTP 204. Missing, unknown, expired, or already-revoked cookies also produce 204. |

Set `Cache-Control: no-store` on all auth responses, including failures, and never
cache authenticated data at an intermediary. No state-changing GET routes.
Configure parsing limits and CORS first, then CSRF rejection for unsafe requests,
login budgets before KDF work, authentication, role checks, and route handling.
Public-route metadata must not bypass the earlier CSRF or limiter layers.
Infrastructure failures return a sanitized 503, not an incorrect-password 401.
Logout must complete revocation before clearing a known session cookie. If the
database is unavailable, return 503 and let the UI offer retry instead of claiming
successful revocation. A request authenticated before revocation commits may
complete subsequent authorization and handling; later authentication must fail.
Stronger transaction-time revalidation belongs to future sensitive workflow
operations.

Bound input before database lookup or hashing:

- Accept only a JSON object with exactly `email` and `password` for login; reject
  arrays, unknown properties, nonstrings, and malformed JSON. Body limit: 4 KiB;
  unsupported media type: 415, oversize body: 413, invalid shape: generic 400.
- Email: at most 254 ASCII characters, ordinary bounded email syntax, no control
  characters or embedded whitespace; trim outer whitespace and lowercase. Apply
  the same canonicalization in provisioning, lookup, and limiter keys. Do not
  add Unicode-email normalization or delivery verification to this MVP.
- Login password: 1–128 Unicode code points, at most 512 UTF-8 bytes, no NUL;
  do not trim, lowercase, normalize, or silently truncate it. Provisioning requires
  15–128 code points with the same byte ceiling; allow spaces and Unicode without
  composition rules. Display name: trimmed nonblank, at most 80 code points and
  320 UTF-8 bytes. These bounds are application validation, not existing SQL rules.
- Unknown email and incorrect password both return the same 401 message,
  `Invalid email or password.` Use a valid dummy Argon2 hash with identical cost
  for an unknown account; never skip KDF work based on account existence. Do not
  claim perfectly identical timings. Invalid stored hashes fail closed with
  sanitized internal diagnostics and the same public authentication failure.

The password-length and generic-error choices follow
[OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).
Use asynchronous hashing/verification; initially bound KDF work to two concurrent
operations and a queue of eight, rejecting excess work with generic 503 and
`Retry-After`. Benchmark latency and memory before deployment. Validate encoded
hash parameters against supported bounds before verification so corrupted hashes
cannot request arbitrary memory. Rerun provisioning must never silently rehash an
existing password; planned accounts use the selected parameters from creation.

### Session creation, rotation, and lookup

After successful password verification, generate a fresh token with Node
`randomBytes(32)`. Never accept a client-selected session identifier or reuse a
token from a cookie, URL, or request body. In one transaction, confirm the user's
stored password hash still matches the verified value, revoke any matching
presented session, and insert the new hashed token. Roll back both operations
on failure; only send `Set-Cookie` after commit. Retry a token-hash collision with
a fresh random token, bounded to three attempts. Failed login neither creates a
session nor revokes an existing valid session. Other devices remain signed in.

The final User read uses `FOR SHARE`, retaining that row lock through rotation
commit. A concurrent password update that owns the lock first makes login wait;
login then reads the committed replacement hash and rejects the previously
verified hash without creating or revoking sessions. If login owns the share lock
first, a non-key password update waits until rotation commits. Password hashing
itself never holds this lock. Future password-change services still need the
documented session-revocation policy; these lock rules do not implement that service.

After acquiring any login-transaction locks, sample fresh PostgreSQL time once
for the new row: set `createdAt` and `lastSeenAt` to that value and `expiresAt` to
that value plus eight hours. Do not derive these values from transaction start
or sample them independently. Keep timestamp arithmetic in PostgreSQL at
`timestamptz(6)` precision.

Only the raw token in the HttpOnly cookie is a bearer credential. Do not put it
in response JSON, local/session storage, URLs, logs, or analytics. No JWT, refresh
token, signed-cookie secret, Passport strategy, or second session store is needed.
Cookies are parsed as untrusted input: validate a single string, the exact token
alphabet/length and canonical encoding, and reject ambiguous duplicate session
cookie names before hashing. Duplicate detection matches the actual parser's
space/tab trimming around names, including before `=`; do not accept
cookie-parser's JSON-cookie objects.

For each protected request, use a short PostgreSQL `READ COMMITTED` transaction:

1. Lock the matching Session row with `SELECT ... FOR UPDATE`. A missing row
   fails authentication. After a wait, use the current locked row, including any
   committed activity or revocation, rather than values read before the wait.
2. After the lock statement completes, sample `clock_timestamp()` as `t` in a
   subsequent statement on the same transaction/connection. Check the locked row
   with that fresh value: `revokedAt IS NULL`, `expiresAt > t`, and
   `lastSeenAt > t - interval '30 minutes'`. Equality at either deadline is expired.
   Do not use `now()`, `CURRENT_TIMESTAMP`, `transaction_timestamp()`, an earlier
   application timestamp, or the start time of the statement that waited for the
   lock. Do not assume a clock expression in the locking SELECT is evaluated
   after the wait. If another relevant lock wait precedes the decision, resample
   afterwards. Keep checks and arithmetic in PostgreSQL, preserving microseconds.
3. If the session is valid and its linked User is resolved, update
   `lastSeenAt = GREATEST(lastSeenAt, t)`, preserving `expiresAt` and `revokedAt`.
   Commit this authentication/activity transaction before returning the principal
   to subsequent role/ownership checks. Concurrent requests must never move
   `lastSeenAt` backwards; failed authentication must not update it.

A session-valid authenticated request counts as activity even if a subsequent
authorization check returns 403 or denies ownership. That denial must not roll
back the committed activity update. Requests rejected before authentication, and
missing, malformed, expired, or revoked sessions, do not count. Public routes do
not refresh a session merely because the browser attaches its cookie.

Revocation uses the same row lock and retains any existing `revokedAt`; activity
never clears it. For a first revocation, sample fresh time after locking and use
`GREATEST(t, lastSeenAt)` to preserve timestamp ordering. If revocation commits
first, a waiting authentication attempt fails without an activity update. If
authentication commits first, that request may proceed to authorization, but
revocation prevents later authentication. Keep these transactions short and
within existing database deadlines; do not hold locks during password hashing
or request-handler work. Reads do not alter the absolute `expiresAt`.

PostgreSQL's transaction time stays fixed, while `clock_timestamp()` samples
current time. Row locks serialize the conflicting session operations. See the
[PostgreSQL 17 time functions](https://www.postgresql.org/docs/17/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT)
and [row-lock behavior](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-ROWS).

No periodic token rotation in this first implementation; each new login rotates
the token. Future privileged password/role changes must revoke affected sessions
in their transaction; no such management endpoint is included now.

## Session storage and new migration

Add `User.sessions` and the following operational model in a new reviewed
migration `20261009000000_add_sessions`. Preserve all existing User IDs and historical lesson/review FKs.

| Field | Proposed storage and constraints |
|---|---|
| `id` | Application-generated UUID primary key. |
| `userId` | Required UUID FK to `User.id`; `ON DELETE RESTRICT`, `ON UPDATE RESTRICT`. One user has zero or many sessions; each session belongs to one user. |
| `tokenHash` | Required `varchar(64)`, unique; SQL check for exactly 64 lowercase hex characters. Raw token never stored. |
| `createdAt` | Required `timestamptz(6)`, explicitly set from the fresh PostgreSQL creation-time sample after login locks are acquired. |
| `expiresAt` | Required `timestamptz(6)`; fixed eight-hour deadline chosen by NestJS. |
| `lastSeenAt` | Required `timestamptz(6)`, initially the same creation-time sample; advances monotonically on session-valid authentication, including requests later denied authorization. |
| `revokedAt` | Nullable `timestamptz(6)`; null means not explicitly revoked, not necessarily valid. |

Indexes: unique `tokenHash` for authentication; `(userId, revokedAt)` for user
revocation; individual `expiresAt`, `lastSeenAt`, and `revokedAt` indexes for bounded
cleanup predicates. Review actual query plans when session volume warrants it.
Add SQL checks `expiresAt > createdAt`,
`createdAt <= lastSeenAt AND lastSeenAt < expiresAt`, and
`revokedAt IS NULL OR revokedAt >= createdAt`. Avoid `CHECK(now() < expiresAt)`:
expiry changes with time and must be checked on access. NestJS owns the eight-hour
policy, one-way revocation, and stable user/token/creation/absolute-expiry fields.
Do not claim these timestamps or SQL checks alone enforce authentication.

The activity predicates ensure `t < expiresAt`; taking the greater of that `t`
and the existing valid `lastSeenAt` preserves `lastSeenAt < expiresAt`. These
static row checks do not enforce monotonic updates across row versions; the
locked update must do that. Revocation may occur after either expiry deadline,
so do not impose `revokedAt < expiresAt` or require an unexpired session to log
out. Cleanup must not refresh activity or change timestamps to make a row valid.

Session records are operational and may be deleted after invalidation; do not
attach the domain immutable-history triggers to them. Lesson revisions, sources,
and reviews stay immutable. No duplicate session `status` or copied user role.
The database enforces shape, uniqueness, relations, and timestamp ordering;
NestJS enforces token creation, password verification, activity/expiry policy,
revocation transactions, and permissions.

The explicit `sessions:cleanup` compiled CLI is implemented using the normal
backend configuration. Delete only revoked, absolutely expired, or idle-expired
Session rows, in batches of 1,000, with a maximum 10,000 deletions per invocation.
Limit each invocation to ten batches as well. Select candidate rows with
`FOR UPDATE SKIP LOCKED`, retain their locks through deletion, then sample fresh
PostgreSQL time after acquisition and recheck the current rows in the deleting
statement. A pre-lock expiry filter is only a candidate-selection optimization.
Delete only if `revokedAt IS NOT NULL`, `expiresAt <= t`, or
`lastSeenAt <= t - interval '30 minutes'` for that post-lock sample `t`. These are
the invalid counterparts of authentication's strict validity comparisons.
If activity wins the lock and the row remains valid at cleanup's post-lock check,
cleanup must preserve it. Idle renewal never overrides absolute expiry or
revocation. If cleanup deletes an invalid row first, waiting authentication finds
no session and cannot recreate it. Skip locked rows for a later batch/run rather
than using stale values to delete them. Never delete by a previously collected
list of IDs without rechecking invalidation under the retained locks.

Local cleanup is manual; a deployment scheduler should run it hourly. Expired
sessions are denied immediately even if cleanup never runs. No startup reset,
user deletion, or cleanup of domain history. The CLI disconnects Prisma on all
paths and uses `process.exitCode` on failure; no unfinished background timer or
unconditional exit. An external scheduler requires no new Nest cron package.

## Browser topology, cookies, CORS, and CSRF

The browser calls NestJS directly. Introduce a fixed, validated public
`NEXT_PUBLIC_API_BASE_URL` for Next.js and explicit `API_PUBLIC_ORIGIN`,
`AUTH_ALLOWED_ORIGINS`, and `AUTH_COOKIE_MODE` for NestJS during implementation.
These origins are configuration, not secrets. Preserve shell precedence and the
existing backend environment loader; do not load root Compose credentials in
Next.js. Validate auth configuration before listening, retaining current
connectivity/deadline/shutdown behavior.

Local defaults: API origin `http://localhost:3001`, allowed UI origin exactly
`http://localhost:3000`, cookie mode `local-http`. Reject inconsistent browser
hostnames; `localhost` and `127.0.0.1` are not interchangeable for cookies/origins.
The PostgreSQL URL remains independent at `127.0.0.1:5433`.

| Cookie attribute | Local HTTP | Deployed HTTPS |
|---|---|---|
| Name | `lessonforge_session` | `__Host-lessonforge_session` |
| `HttpOnly` | true | true |
| `Secure` | false, loopback development only | true |
| `SameSite` | `Lax` | `Lax` |
| `Path` / `Domain` | `/`; omit Domain | `/`; omit Domain |
| Lifetime | `Max-Age` eight hours, matching absolute expiry | Same |

Clear the cookie with the same name/path/security/SameSite policy and no Domain,
using expiry in the past. Browser lifetime does not replace server-side idle or
absolute checks. Reject nonloopback `local-http` origins; `NODE_ENV=production`
requires HTTPS mode. Compiled local startup is still possible with the explicit
development settings; do not infer transport security from compiled code or
untrusted forwarded headers. Cookies do not isolate ports: locally Next.js may
also receive the localhost cookie, so neither application may log Cookie headers.
With deployed API/frontend subdomains, omit Domain to keep the API cookie off
the frontend host. These attributes follow
[the Set-Cookie reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).

Recommend deploying the UI and API on HTTPS subdomains of one controlled
registrable domain. They are cross-origin but same-site. Unrelated hosting domains
would require a different cookie/topology design and may encounter third-party
cookie blocking; do not silently switch to `SameSite=None`. A same-origin reverse
proxy could be selected later, but is not part of the initial direct-browser plan.

Every auth request uses `credentials: 'include'`; login/logout use
`Content-Type: application/json` and `X-LessonForge-CSRF: 1`. The frontend never
reads the session cookie or sets an Authorization bearer header. Configure Nest
CORS with `credentials: true`, an exact parsed-origin allowlist, explicit methods
and allowed headers (`Content-Type`, `X-LessonForge-CSRF`), and `Vary: Origin`.
Never use `*`, arbitrary origin reflection, wildcard subdomains, or suffix matching.
Only approved CORS preflights bypass authentication; this does not make API writes
public. [Nest CORS configuration](https://docs.nestjs.com/security/cors).

For every unsafe method, including **public login and idempotent logout**, enforce
both an exact allowed `Origin` and the exact custom header value before any auth
state change. Reject missing, `null`, malformed, or unlisted origins and missing
headers with 403; reject form/simple content types. Do not fall back to a substring
Referer match. Reject `Sec-Fetch-Site: cross-site` when supplied for this same-site
topology; requests without Fetch Metadata still require Origin/header checks.
Keep CSRF validation independent of `@Public()` and authentication guards. The
header's value is a preflight marker, not a secret synchronizer token; strict
Origin validation and credentialed CORS are essential. This also covers login
CSRF without creating anonymous prelogin sessions or an extra endpoint.
[OWASP's API custom-header and login-CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

Do not turn arbitrary URLs/query parameters into API destinations or attach
credentials to untrusted destinations. CSRF defenses do not cure XSS: keep React
escaping, do not render resource/AI text as raw HTML, and add deployment security
headers in that milestone.

## Authentication, roles, and future ownership

Register an authentication guard with `APP_GUARD`, requiring a valid session by
default. A narrowly scoped `@Public()` decorator marks only `GET /`, login, and
logout. Public means authentication is optional, not exempt from CSRF/rate limits.
Logout handles its cookie explicitly. All newly added routes remain protected
unless deliberately annotated. Expose a typed request principal derived from
the session and current User record, never request body IDs or cookie claims.

Run role authorization after authentication using `@Roles(TEACHER)` and
`@Roles(ADMIN)` metadata and a role guard. `/auth/me` accepts either role; later
resource mutation/review routes require ADMIN, and teacher draft/submission routes
require TEACHER. Missing session is 401; an authenticated wrong role is 403.
Test guard order explicitly rather than relying on accidental module order.
[Nest authorization guidance](https://docs.nestjs.com/security/authorization).

Role guards cannot establish lesson ownership. Later lesson services must query
with the authenticated owner ID and enforce ownership, lifecycle, and version
rules in the same transaction as mutations. Set `ownerId`/`reviewerId` from the
principal. A teacher cannot access another teacher's draft by knowing its UUID;
admins are not automatically permitted to edit teacher drafts. Authorize before
a conflict response includes any current content, as the confirmed design
requires. Library reads and approved-copy eligibility follow the specification,
not a blanket ownership rule. This step establishes guards; it does not implement
those workflow services or claim the application permissions are all complete.

## Login rate limiting and deployment limits

Use `@nestjs/throttler` with two named login budgets: 20 attempts per client IP per
five minutes, and five attempts per canonical email/IP pair per five minutes.
Both count successes and failures before KDF work and do not reveal account
existence; return generic 429 with `Retry-After`. Enforce the IP budget first, then
create bounded email/IP tracker keys (hash identifiers rather than logging them).
Cap in-memory tracker cardinality at 10,000 with expiry pruning and reject new
keys with generic 503 at capacity instead of evicting live budgets. Other auth
routes get a 120-requests-per-IP-per-minute budget. Rate-limit public login too.
TTL values in this library are milliseconds. Use a small storage adapter around
the limiter for the capacity bound and test cleanup/shutdown.
[Nest rate-limiting guidance](https://docs.nestjs.com/security/rate-limiting).

For local single-process development, in-memory storage is sufficient. Restart
clears budgets; independent replicas do not share counts, and rotating IPs can
attack the same account. A production shared limiter/edge policy must be selected
before public exposure; PostgreSQL sessions alone do not solve this. Avoid
permanent account lockouts that an attacker can trigger. No Redis deployment or
extra rate-limit database model is added in this first step.

Locally leave Express `trust proxy` disabled. At deployment, configure only the
actual trusted proxy addresses/hops and require that proxy to replace forwarded
headers; do not trust arbitrary `X-Forwarded-For` or enable unconditional trust.
Otherwise attackers can bypass IP budgets or all users can share a proxy's quota.
Network policy must prevent bypassing that ingress. Hosting/proxy/shared-storage
choices are deployment prerequisites, not already verified protections.
[Express trusted-proxy guidance](https://expressjs.com/en/guide/behind-proxies/).

Redact Cookie, Set-Cookie, passwords, password hashes, and token hashes from logs,
request tracing, validation errors, and CLI output. Log outcome/status and a
request ID; do not emit raw Prisma/driver errors or request bodies. Use the existing
sanitized-error approach for connectivity failures.

## Explicit local account provisioning

Implement an interactive compiled CLI in step 2, tentatively:

```bash
npm run build --prefix backend
npm run accounts:provision --prefix backend
```

These are **planned** commands: `accounts:provision` does not exist yet. Build
generates/compiles the backend and applies no migration; provisioning would create
only the explicitly entered local accounts after migrations have been applied.
It must never run automatically in build, startup, Prisma generation, or CI.

The command loads normal backend configuration explicitly, preserves shell
precedence, and rejects targets except the existing local
`127.0.0.1:5433/lessonforge_dev` without query parameters before constructing a
client. It is a deliberately authorized local write command, distinct from the
read-only `test:db`. Require an explicit interactive acknowledgement showing only
host, port, and database, never credentials. Reject noninteractive input by default.

Prompt for one teacher and one administrator's canonical email and display name,
then a masked password and masked confirmation for each missing account. Restore
terminal echo on cancellation/error and reject identical canonical emails. Do
not accept passwords in command-line arguments, generated examples, or committed
seed files; do not print passwords or hashes. Hash with the same password service.

In one transaction, insert missing users with explicitly assigned roles. If an
email already exists with the expected role and display name, report unchanged
and skip password prompts for it; do not compare, overwrite, or silently rehash
its password. A role/display-name mismatch refuses the whole operation with no
writes. Recheck under the transaction; unique-email races must reread and apply
the same policy or abort, never use update-on-conflict. Keep existing IDs stable.
No default credentials, public registration, resource seeding, or password/role
reset switches. If a later maintenance command is needed, design explicit
confirmation and session revocation separately. Always disconnect Prisma and
return a nonzero exit code on failure/cancellation.

Separate the guarded CLI entrypoint from a provisioning service taking an already
authorized client and supplied account data. Only the interactive local command
loads real configuration; isolated tests invoke the same service with fixture
credentials and the disposable harness, never weaken the production CLI guard.

## Required packages and developer installation

Versions checked against official upstream release/manifests on 2026-10-09:

| Package | Purpose and compatibility evidence |
|---|---|
| `argon2@0.45.1` | Password KDF, bundled TypeScript types; [official release](https://github.com/ranisalt/node-argon2/releases/tag/v0.45.1). Its [manifest](https://raw.githubusercontent.com/ranisalt/node-argon2/master/package.json) supports Node >=16.17; Node 24 meets that declaration. Native hash/verify is now verified locally; a fresh CI/deployment installation still needs verification. |
| `cookie-parser@1.4.7` | Nest's Express cookie parsing; [official release](https://github.com/expressjs/cookie-parser/releases/tag/1.4.7) and [Nest usage](https://docs.nestjs.com/techniques/cookies). Use unsigned opaque cookies; validate parsed values. |
| `@nestjs/throttler@6.7.1` | Login/auth rate limits; [official release](https://github.com/nestjs/throttler/releases/tag/v6.7.1) and [tagged manifest](https://raw.githubusercontent.com/nestjs/throttler/v6.7.1/package.json) explicitly include NestJS 12 and Node 24 compatibility. |
| `@types/cookie-parser@1.4.10` | Development-only Express request typing; [published metadata](https://www.npmjs.com/package/%40types/cookie-parser?activeTab=code) and [maintainer definitions](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/cookie-parser). |

Historical installation instructions (the developer has already installed these
packages and the implementation preserves the manifest/lockfile changes):

```bash
nvm use
npm install --prefix backend --save-exact argon2@0.45.1 cookie-parser@1.4.7 @nestjs/throttler@6.7.1
npm install --prefix backend --save-dev --save-exact @types/cookie-parser@1.4.10
```

`nvm use` selects `.nvmrc`; the npm commands change backend `package.json`,
`package-lock.json`, and `node_modules`, and may download/build Argon2's native
binary. Review those changes and retain the lockfile. No Prisma/Nest/Next upgrade
or frontend dependency is required. Do not use `--force` or `--legacy-peer-deps`
to hide compatibility errors. No installation or import smoke test ran in the historical
planning task. The later implementation verified installed declarations and a real
Argon2 hash/verify test locally; that does not verify a clean install or a new
GitHub Actions run. Deployment benchmarking remains pending.

## Three reviewable implementation steps

### 1. Backend sessions, endpoints, guards, and migration

Add session storage and a new migration; password/token/cookie/config helpers;
AuthModule endpoints; default authentication and role guards; CSRF enforcement;
bounded login rate limiting; and cleanup CLI. Use existing startup/shutdown and
Prisma configuration. Update examples/setup/CI notes without real secrets. Review
all generated and custom migration SQL and leave the applied initial SQL intact.
Generate the new migration offline, test the full migration chain on a fresh
disposable target, and keep development application an explicit later developer
step. This deliverable has test accounts only inside isolated fixtures; no local
account is silently seeded.
Update the existing constraint suite's one-migration assertion for the new chain
and include Session rows in its full-database snapshots. Preserve all existing
negative constraint assertions and disposal guards.

Acceptance: protected routes deny missing/revoked/expired sessions, role tests
deny teacher review/admin teacher-only actions on test-only handlers, login
rotates tokens transactionally, logout revokes them, and public routes retain
CSRF/rate-limit enforcement. No token/hash appears in JSON/errors/logs. All existing
database-free CI commands still pass without credentials or real environment files.

### 2. Local account provisioning

Add the compiled interactive command and reusable transactional provisioning
service, guards/acknowledgement/masked input, safe rerun handling, and tests. Update
setup with exact commands and effects. Use generated fixture accounts for tests;
the developer runs real local provisioning separately. Resource text/seeding is
outside this account-focused change.

Acceptance: missing accounts are created with correct roles and verifiable hashes;
a rerun leaves IDs/passwords/roles untouched; a conflicting existing role/name,
duplicate input email, cancellation, or database error leaves no partial users.

### 3. Next.js login/logout and current-user handling

Add a Client Component login form and one browser API helper with a fixed API
base URL, included credentials, and CSRF headers on unsafe methods. Use accessible
labels, `autocomplete="username"` / `"current-password"`, pending/error states,
and clear the password from component state after submission. Do not persist it.
Add a small current-user context with loading/authenticated/unauthenticated/error
states: fetch `/auth/me` on initial mount, update after login, and clear only after
successful logout or a confirmed 401. A network/503 failure is not proof of logout.

Show display name/role and a logout button; do not invent dashboards or domain
screens. Never treat client role checks or redirects as authorization. Initial
Next Server Components render the public shell and do not read/forward API
cookies; this avoids creating a second session owner or personalized server cache.
Revisit forwarding and caching explicitly if SSR is later needed.
[Next.js authentication guidance](https://nextjs.org/docs/app/guides/authentication)
distinguishes UI checks from authoritative data-access checks; LessonForge's
authoritative data access remains NestJS.

Acceptance: a browser can log in with either provisioned role, survive a refresh
through `/auth/me`, log out, and see safe errors for invalid credentials, expired
sessions, blocked CSRF, rate limits, and API unavailability. Browser inspection
confirms cookie attributes and credentialed preflights; no bearer token is readable
by JavaScript. No lesson workflow or AI behavior is claimed by this interface.

## Verification plan and remaining decisions

Ordinary Vitest unit/HTTP tests remain database-free. Override the session/user
repository, clock, rate-limit storage, and environment loading in HTTP fixtures;
keep real guards, CORS/CSRF setup, and cookie handling. Test a default-protected
route and explicit public routes, bounded credential validation, safe projections,
generic failures, both role decisions, allowed/disallowed/missing origins,
preflights, simple-content rejection, secure/local configuration, 429/503 behavior,
activity committed before a later authorization denial, failed authentication
without activity, revocation/expiry boundaries and races, monotonic activity,
cleanup predicates, and startup/shutdown disposal. Unit tests may use a real
Argon2 hash/verify smoke test without a database;
do not weaken production KDF parameters to make tests fast. Fakes prove service
behavior only, not PostgreSQL enforcement or actual browser cookie rules.

The separate `test:auth:db` command/config is now implemented,
matching a suffix such as `*.auth-db-spec.ts` excluded from ordinary `.spec.ts`
and `.e2e-spec.ts` suites. Reuse the existing disposable URL/acknowledgement guard
and live identity/empty-schema preflight at
`lessonforge_constraints@127.0.0.1:5434/lessonforge_constraints_test`; never load
`.env` or fall back to `DATABASE_URL`, reset a populated target, or reuse a
development database. Each live command needs a fresh container, not a second
suite trying to migrate a target already used by `test:constraints`.

Real PostgreSQL tests must apply the entire migration chain and prove unique hash
and FK/check failures by SQLSTATE/constraint name; session persistence across
client/application recreation; valid and invalid credentials with real hashes;
absolute/idle expiry; token rotation/rollback; logout and replay failure; and
cleanup that preserves active sessions and all domain history. Add coordinated
tests with independent connections and explicit synchronization:

- Race a real non-key User password update with login's final `FOR SHARE` read
  in both lock orders. Observe the relevant PostgreSQL wait: update-first must
  produce a generic credential failure with no new session or prior-session
  revocation; login-first must retain the share lock until rotation commits,
  delaying the update. Keep the direct verified-hash mismatch regression too.
- A request begins while valid, then waits on a Session lock past the absolute
  deadline; after acquiring the lock it must fail authentication without updating
  `lastSeenAt`. Repeat for the idle deadline. Use near-boundary fixture timestamps
  and short bounded waits observed against PostgreSQL time, not hours of sleeping
  or a mocked clock. Ensure the request actually waited and crossed the deadline;
  a lock/query timeout or unrelated SQL failure is not evidence of expiry denial.
- Start concurrent activity transactions in a different order from their lock
  acquisition/commit order. Each must use post-lock time/current row values and
  the final `lastSeenAt` must never be below a previously committed value. Cover
  the monotonic `GREATEST` rule with controlled clock inputs in unit tests too.
- Exercise both activity/revocation lock orders: revocation-first rejects waiting
  authentication with no activity write; activity-first may authenticate that
  request, then revocation commits and every later authentication fails. Assert
  that no activity update clears or replaces `revokedAt`.
- A valid session followed by a role/ownership rejection still commits activity;
  invalid-session authentication changes no timestamps. Check boundary equality,
  fixed absolute expiry despite activity, and logout after expiry against the
  timestamp checks.
- Race cleanup against activity/revocation: a refreshed valid row survives,
  skipped locked rows are reconsidered later, and a deleted expired/revoked row
  cannot be authenticated or revived. Verify row limits and preserve domain history.

Exercise provisioning reruns/conflicts through the real shared service, and
preserve the live harness refusal cases.
Database assertions must not pass because a different FK/trigger failed. These
tests are explicit, mutating, disposable-only, and never added to ordinary CI.

After each implementation step, run the current backend build, non-mutating lint,
`tsc --noEmit`, unit and HTTP checks; run explicit live tests separately. Step 3
also needs frontend lint/typecheck/build and a manual browser demonstration.
The existing frontend has no browser-test runner; adding Playwright is a separate
choice rather than an undeclared package requirement. Record actual checks and
environment restrictions separately from a GitHub Actions result. Provisioning
and development migration application require explicit developer execution.

No blocking product question remains for the first implementation. The developer
has adopted eight-hour absolute expiry, 30-minute idle expiry, concurrent-device
sessions, and current-session-only logout for the MVP. The activity semantics,
monotonic updates, fresh post-lock expiry checks, and race-test requirements above
are part of the finalized plan. Exact sample account details are entered during
provisioning; deployment and the remaining provisioning/interface work still need
verification.
Deployment still needs chosen UI/API origins under a controlled same-site domain,
trusted ingress configuration, shared login limiting, and a cleanup scheduler.
Unrelated-domain hosting or all-devices logout would need an explicit design
revision. Password recovery/MFA/account management remain outside this task.

Historical planning status: only this design and its official-source/package
review were completed in the planning task; authentication implementation and its
checks were then pending. See [authentication verification](authentication-verification.md)
for the later backend implementation evidence. Browser verification, provisioning,
development application of the Session migration, and production configuration
remain pending; prior domain/foundation evidence does not verify those steps.
