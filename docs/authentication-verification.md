# Backend authentication verification

## Scope and implementation

Step 1 of [authentication design](authentication-design.md) implements backend
sessions, login/me/logout, default authentication/role guards, cookie/CORS/CSRF
policy, bounded rate/KDF work, and an explicit cleanup CLI. Provisioning and the
Next.js login interface remain steps 2 and 3. Ownership and workflow services,
seeding, password recovery, and AI are not implemented here.

`20261009000000_add_sessions` is additive. It creates Session with UUID identity,
a restricted User FK, unique lowercase SHA-256 token hash, timestamptz timestamps,
expiry/activity/revocation checks, and expiry/activity/revocation/user indexes.
The applied `20261008000000_initial_domain` SQL is unchanged (SHA-256
`d9bbae7b26f928d56ebad2191eb9ae0702ce7179e5abce2abb239774d31b65da`).
No domain immutability trigger is attached to operational Session rows. An offline
Prisma schema-to-schema SQL diff was inspected: the table, indexes, and restricted
FK match the new migration; its transaction wrapper and checks are reviewed SQL
additions. The diff contacted no database.

NestJS still owns the eight-hour absolute and 30-minute idle policies, stable
identity/token/creation/absolute-expiry fields, monotonic activity, one-way
revocation, token generation, password verification, and permissions. Static SQL
checks alone do not enforce those rules. Authentication locks the current row,
then samples `clock_timestamp()` in a separate statement. SQL text timestamp
parameters retain microseconds; responses expose safe users and absolute expiry
only. Authentication commits activity before role rejection. Login holds no
session lock during KDF work, rechecks the verified hash under a User lock, and
revokes/creates in one transaction. Failed/colliding creation rolls back revocation;
only the specific token uniqueness failure is retried, at most three times.

Cleanup uses retained row locks with SKIP LOCKED, a fresh post-lock time sample,
and invalidation rechecks on deletion. It is explicit, at most 1,000 rows per
batch and ten batches/10,000 rows per invocation. No startup cleanup or timer
was introduced. Native KDF work has two active slots and eight queued jobs;
shutdown refuses new work and awaits the accepted jobs. Authentication has a
shutdown latch so a late successful KDF cannot begin rotation. The repository
refuses new operations and drains accepted ones before dependent Prisma teardown;
a real Nest module-order regression test covers that boundary. Existing database
connection/query/startup deadlines and forced HTTP socket shutdown remain.

## Initial step-1 agent-run checks on 2026-10-09

Checks use an isolated backend copy under `/tmp` with existing installed
`node_modules`, excluding real `.env` files, build output, and generated client.
Prisma generation runs there without credentials or a database URL. No package
installation or clean `npm ci` was performed. Developer dependency/lockfile
changes are preserved.

Installed Node is `v24.21.0` (the repository version). Installed NestJS is 12.1.2,
Prisma/adapter are 7.10.0, Argon2 is 0.45.1, cookie-parser is 1.4.7, throttler is
6.7.1, and cookie-parser types are 1.4.10. Engine/peer declarations were inspected;
real native Argon2id hash/verify passed with 64 MiB, three iterations, parallelism
one, random 16-byte salt, and 32-byte output. The installed encoder emits
`m=65536,p=1,t=3`; validation accepts this and the equivalent `m=65536,t=3,p=1`
ordering with the same bounded parameters. Runtime on this host does not prove
fresh installation/native compatibility on GitHub or a deployment host.

| Check | Result |
|---|---|
| Prisma schema validation and generation without credentials | Passed |
| Ordinary unit tests | 108 passed |
| Database-free HTTP tests | 22 passed |
| Live authentication suite | 28 passed on fresh PostgreSQL 17.11 |
| Retained live domain constraint suite | 39 passed on another fresh PostgreSQL 17.11 container |
| Production build, non-mutating lint, full TypeScript | Passed |
| Compiled ESM Argon2 hash/verify | Passed |
| Compiled startup with invalid auth configuration | Sanitized error and expected exit code 1 before database access |
| Authored-code formatting, documentation links/commands, whitespace | Passed; finalized after resume |

The HTTP suite uses the real guards, cookie parser, shared bootstrap HTTP policy,
CORS/CSRF, and rate limiter with repository/password fakes. It covers default
protection, explicit public routes, both teacher/admin permissions, safe
projections, local/HTTPS cookie set/clear attributes, malformed/duplicate cookies,
strict JSON bounds, exact/missing/disallowed origins, credentialed preflights,
generic login errors, sanitized database failures, logout failure without clearing,
canonical email/IP budgets, shared me/logout quota, spoofed forwarded headers,
and capacity rejection. It does not demonstrate a browser's cookie behavior.

Initial sandbox HTTP runs were blocked by `listen EPERM`; retries used permission
for ephemeral local listeners. Running several heavy checks concurrently caused
startup/hook timeouts and one disposable migration-command timeout. Checks were
rerun sequentially; CI budgets and production database deadlines were not relaxed.
Native work is isolated from the existing socket/signal fixtures and tested
separately. A separate compiled ESM smoke test also hashed and verified a transient
fixture password successfully. Compiled startup with intentionally invalid auth
configuration returned a sanitized error and exit code 1 before database access;
this is an expected rejection, not a healthy compiled-startup demonstration.
Historical unsuccessful attempts are not recorded as passing evidence.

## Disposable PostgreSQL coverage

Both explicit suites use fresh PostgreSQL 17.11 containers with temporary storage
and the existing exact `127.0.0.1:5434/lessonforge_constraints_test` target guard.
They require `LESSONFORGE_CONSTRAINT_TEST=disposable`, the dedicated fixture role,
a matching connected identity, and an empty public schema before migration/fixture
writes. They never load `.env`, use `DATABASE_URL` as a fallback, or reset a target.
Only task-created disposable containers are removed. The agent did not connect
to or migrate `lessonforge_dev`, alter existing Docker data, or seed local accounts.
The earlier developer application of the initial migration remains separate
[historical evidence](domain-schema-verification.md).

The authentication suite applies the full two-migration chain and exercises:

- Real Argon2 credentials and HTTP login/me/logout; persistence across client
  recreation, safe responses, concurrent devices, and failed-login preservation.
- Transactional rotation, real unique-hash collisions/rollback, bounded retries,
  changed verified-hash rejection, logout replay, and current-device-only revocation.
- Real SQLSTATE/constraint-name failures for token uniqueness, Session's User FK
  (including restricted referenced User updates/deletes), token shape, required
  columns, and timestamp checks. Expiry ordering overlaps activity ordering;
  its independent proof temporarily removes the activity check inside a transaction
  that always rolls back, then asserts the check and original row are restored.
- Independently coordinated connections and observed PostgreSQL lock waits that
  cross both real absolute and idle expiry deadlines. Expiry denial must return
  null/401 with unchanged activity; a timeout/error cannot pass that test.
- Both activity/revocation lock orders, opposite transaction-start/lock order,
  monotonic activity, fixed absolute expiry, and committed activity before HTTP 403.
- Cleanup races against activity and revocation, skipped locks, renewed active
  rows, deleted-row replay denial, preserved domain history, and batch/run limits.

Exact boundary equality uses a controlled timestamp returned from PostgreSQL;
backwards-clock protection uses a later-stored fixture timestamp. Collision tests
force actual duplicate inserts through the production repository. These controlled
inputs are distinct from the real-time expiry/lock-wait tests; neither uses mocked
PostgreSQL failures as proof of a migration constraint.

The retained domain suite also verifies all historical constraints, referenced-key
updates, immutability/write-once triggers, and refusal of populated/mismatched
live targets without changing contents. Its migration count is now two, and full
snapshots include Session. Immutable-row triggers still do not prohibit inserting
additional RevisionSource rows; future NestJS submission services must enforce
source-set finalization transactionally.

## Initial finalization and cleanup after resume

The recorded passing results above were reused. All 53 authored implementation,
test/configuration, schema/migration, and manifest files compared with the passing
verification copy were identical. The initial migration and the developer-installed
lockfile also retained their recorded SHA-256 fingerprints. No application code or
migration changed during finalization, and no live suite was rerun against a
populated database. Relative documentation links (including section anchors),
npm command names, README path formatting, authored-code formatting, and tracked
plus new-file whitespace were checked again after the documentation edits.

Before stopping the final task-created container, Docker inspection verified the
exact ID `731855e9f9de01709157066a657eda54815bb6b3b1e89e74ae64abca56c4fc06`,
name `lessonforge-auth-agent-20261009`, image `postgres:17.11-bookworm`, localhost
`5434:5432` binding, tmpfs data storage, no mounts, and automatic removal. Only
that verified ID was stopped; its removal was confirmed. Earlier task-created
containers had already been disposed. No task-created container or command
process remains running. The isolated verification copy was removed, including
its dependency symlink; the repository's installed dependencies were preserved.
Existing containers/volumes and the development database were untouched.

## Authentication review follow-up on 2026-10-09

The cookie-name ambiguity finding is fixed in `auth.cookies.ts`. The installed
`cookie-parser` delegates to a parser that trims spaces and tabs around cookie
names, including before `=`. Duplicate detection now applies that same trimming
and ignores entries without `=` before selecting the parsed token. No parser or
dependency version changed.

Before the fix, all 24 new duplicate-cookie cases reproduced HTTP 200 instead of
400 at `/auth/me`. After the fix they exercise `/auth/me`, login, and logout through
the real shared cookie-parser middleware: local and HTTPS names, spaces/tabs,
either or both names padded before `=`, and both token orders. Every request must
return 400 without session lookup, credential lookup/KDF, rotation, or revocation
repository calls. Six additional single-cookie cases verify accepted unpadded,
space-padded, and tab-padded names in both modes and the correct token hash at
authentication, rotation, and revocation.

Two new live cases use dedicated fixture users, real Argon2 credentials, independent
connections, and bounded barriers. With the password UPDATE first, PostgreSQL's
observed waiter must be login's `FOR SHARE` read. The committed replacement hash
then causes the generic `LoginFailure`; no new session or prior-session revocation
is allowed, and existing session rows remain identical. With login's share lock
first, an observed UPDATE waits until rotation commits; the old session is revoked
and one new session is created before the password update completes. Database
timeouts/errors cannot satisfy those outcomes. The direct verified-hash mismatch
test remains unchanged. No password-change endpoint or automatic revocation policy
was added.

| Follow-up check | Result |
|---|---|
| Ordinary unit tests | 108 passed |
| Full database-free HTTP suite | 52 passed, including 30 new cookie cases |
| Full live authentication suite and two-migration chain | 30 passed, including both new User lock-order cases |
| Production build with Prisma generation, non-mutating lint, full TypeScript | Passed |
| Changed-code formatting, documentation links/commands, whitespace | Passed |

Checks again used an isolated `/tmp/lessonforge-auth-review-check` backend copy,
excluding all `.env*` files and using the existing dependency symlink. The live
suite used a **fresh** `lessonforge-auth-review-20261009` PostgreSQL 17.11 container,
ID `55e2e24f32ca878a4fa884364e831edf71972a221666e74e98de5f230e3d9589`.
Inspection confirmed healthy state, localhost `5434:5432`, tmpfs data, no mounts,
and automatic removal. The existing URL/acknowledgement, connected-identity, and
empty-schema guards ran before migrations/fixtures; `DATABASE_URL` was unset.
Only this verified container was stopped after the passing suite, and removal was
confirmed. No populated target was reused. The isolated copy was removed afterward;
installed dependencies were preserved. No task-created resources remain running.
The applied initial migration and developer dependency lockfile retain their
recorded fingerprints. The 39 domain constraint results above were retained,
not rerun in this follow-up; domain SQL and models are unchanged.

These are local agent checks, not a new GitHub Actions run or clean installation.
Native KDF shutdown latency under load and latency/memory benchmarking were not
measured. The earlier lifecycle/drain-order tests and real hash/verify results
do not establish those measurements.

## Developer commands and remaining gaps

From the repository root, review the new SQL and your configured target, then:

```bash
npm run build --prefix backend
./backend/node_modules/.bin/prisma migrate deploy --config backend/prisma.config.ts
./backend/node_modules/.bin/prisma migrate status --config backend/prisma.config.ts
npm run start:prod --prefix backend
```

Build generates/compiles only. Deploy applies unapplied migrations to the normally
configured database; with the initial migration applied it adds Session storage.
Status only reports migration state. Startup verifies connectivity and listens;
it does not migrate or seed. The agent has not run these against development.
`GET /` stays public, and `GET /auth/me` without a session should return 401.
Ctrl+C should await cleanup and return to the shell. Real local login needs step 2
account provisioning; no provision command/default credentials exist yet.

After a successful build/migration, `npm run sessions:cleanup --prefix backend`
is an explicitly mutating maintenance command deleting invalid Session rows only,
with the limits above. It loads normal backend configuration; do not run it merely
to verify ordinary CI.

For isolated live checks, use the fresh-container/health/run/disposal procedure in
[development setup](development-setup.md#disposable-authentication-tests). Run
`test:auth:db` and `test:constraints` against **different fresh containers**, with
client generation/build complete and these explicit fixture variables:

```bash
CONSTRAINT_TEST_DATABASE_URL='postgresql://lessonforge_constraints:constraint_fixture_only@127.0.0.1:5434/lessonforge_constraints_test' \
  LESSONFORGE_CONSTRAINT_TEST=disposable npm run test:auth:db --prefix backend
```

For the domain suite, substitute `npm run test:constraints --prefix backend` only
after disposing/recreating the dedicated container. Both commands apply migrations
and mutate only disposable fixture data. A populated target is deliberately refused.
No installation is needed for this task's already-installed dependencies.

Remaining evidence: developer application/status of the Session migration and
compiled startup against it; a GitHub Actions run containing this implementation;
a fresh native-package installation on the actual runner/host; deployed/browser
cookie and CSRF behavior; realistic KDF latency/memory benchmarking and native
KDF shutdown latency under active/queued hashing work. Neither latency measurement
has been performed; lifecycle/drain-order regression tests are not such a measurement.
The standalone
cleanup CLI entrypoint has not been executed; its build and the shared cleanup
service’s live SQL/race/limit tests passed. Local account provisioning and frontend
login are pending implementations. Public deployment
also requires selected HTTPS same-site origins, trusted proxy/ingress policy,
shared/edge rate limiting, and an hourly cleanup scheduler.
