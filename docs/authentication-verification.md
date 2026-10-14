# Backend authentication verification

## Scope and implementation

Step 1 of [authentication design](authentication-design.md) implements backend
sessions, login/me/logout, default authentication/role guards, cookie/CORS/CSRF
policy, bounded rate/KDF work, and an explicit cleanup CLI. Step 2 adds guarded
local account provisioning. Step 3 implements the Next.js login/current-user
interface; [frontend verification](frontend-authentication-verification.md) records
its checks and pending manual browser verification.
Ownership and workflow services,
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

## Account provisioning checks on 2026-10-13

Step 2 implements `accounts:provision` as a separate compiled entrypoint. Both
terminal streams and zero arguments are required before environment loading.
The local-development URL guard runs before client construction; interactive
acknowledgement and validated account details precede connection. The connected
database identity is checked too. Password/confirmation input is hidden and kept
out of readline history. Cancellation restores terminal mode, drains accepted
native work, and disconnects; messages never include supplied secrets or driver
errors. A failure around commit can require a safe rerun to confirm state.

The CLI skips password prompts for matching existing roles/names. The shared
`AccountsService` validates both accounts, skips hashing for matching reruns,
hashes missing credentials using the existing Argon2 service outside the
transaction, and locks/rechecks existing User rows before creating any missing
rows. Email races abort the whole transaction
and request a rerun; no upsert/password/role/name/ID replacement exists. The shared
password validator preserves existing login bounds and uses the fifteen-code-point
provisioning minimum. No migration, model, HTTP endpoint, default credential,
resource seed, or frontend behavior was added.

| Check | Result |
|---|---|
| Production build with Prisma generation | Passed |
| Non-mutating lint and full TypeScript | Passed |
| Ordinary unit suite | 162 passed, including 54 provisioning cases |
| Full database-free HTTP suite | 52 passed |
| Fresh disposable provisioning suite and two-migration chain | 10 passed |
| Compiled terminal-only probes | Success, Ctrl+C, empty-prompt Ctrl+D, and SIGTERM passed; hidden input and original TTY settings verified |
| Compiled CLI refusal probes | Noninteractive input, redirected output, and wrong target rejected with sanitized messages and exit 1 |
| Changed-code formatting and whitespace | Passed |

Checks ran on Node 24.21.0 using `/tmp/lessonforge-provision-check-5oigipl6/backend`,
copied without `.env*`, build output, or generated client, and linked to existing
installed dependencies. No installation ran. All ten changed/new backend
implementation/test/configuration/manifest files matched the final verification
copy. Ordinary tests cover validation, target/acknowledgement guards, reruns,
confirmation/role/name conflicts, native failures, cancellation before a
transaction, terminal EOF/signal/input errors, sanitized errors, and cleanup.
The terminal-only probes import the compiled prompt class without environment or
database code. The actual compiled CLI was invoked only for refusal checks in the
isolated copy, never against development.

Live tests use the existing exact disposable URL/acknowledgement, connected
database/role identity, and empty-public-schema preflight before migrations and
fixtures. They verify real Argon2 credentials and persistence across clients,
unchanged reruns including full stored-row timestamps/hashes, missing-only
creation, role/name conflict refusal, rollback after real inserts, cancellation
rollback, a committed name change before the transaction recheck, a real
concurrent unique-email insert winning over provisioning, and a PostgreSQL-observed
UPDATE waiting for provisioning's retained share lock. Fixture domain/session rows
remain unchanged. Timeouts and unrelated errors cannot satisfy successful outcomes.

The initial sandbox live attempt failed at the identity query before writes;
the permitted rerun passed all ten cases. HTTP listeners were initially denied
with `EPERM`; the permitted rerun passed all 52. Terminal cancellation/error
issues found during unit verification were fixed before the final 162-test pass.
Neither a blocked attempt nor an intermediate failing run counts as passing evidence.

Both task-created PostgreSQL 17.11 containers used localhost `5434:5432`, tmpfs
storage, no mounts, and automatic removal. The first was
`lessonforge-provision-agent-20261013`, ID
`f21cb0a4999076edf14457e45927c91573f0cd057107ef3208f038922575220c`.
The final fresh run was `lessonforge-provision-final-20261013`, ID
`a38d7da5f768b2e33a131158a01b25a88509a2b35fc2d86d321dd3a4e91f29bd`.
Only these verified task-created containers were stopped; removal of both was
confirmed. The isolated copy, its dependency symlink, path record, and terminal
probe were removed; repository dependencies remain intact. No task-created
container or command process remains running. No development database, existing
container/volume, or real environment file was accessed. Both applied migration
files, Prisma schema, and
the installed dependency lockfile are unchanged. The earlier 30 live authentication
and 39 domain constraint passes are retained rather than rerun; their storage and
session implementation are unchanged. These local checks are separate from a
new GitHub run, a clean native installation, and deployment/KDF performance measurements.

## Provisioning terminal isolation fix on 2026-10-13

The follow-up review reproduced a password exposure missed by the earlier 162
unit tests and compiled terminal probes: readline retains Ctrl+U/Ctrl+Y cut/yank
text independently of `historySize: 0`. Reopening the output gate after hidden
confirmation allowed that text to be echoed while provisioning was pending.
The earlier passing evidence above is historical and did not cover this case.

`TerminalAccountPrompts` now closes and recreates the readline interface for
every prompt. A separate silent interface between prompts handles cancellation
without forwarding editing output; it is discarded before the next prompt.
Secret and idle editing buffers therefore cannot reach a later visible prompt.
Each retired output gate stays muted. Visible answers mute their gate
synchronously on the public `line` event, including when extra keys follow Enter
in the same input chunk. The implementation uses public readline APIs without
reading or changing private editing state. Password whitespace/Unicode,
confirmation, original terminal-mode restoration, and CLI cleanup are preserved.

Seven additional regression cases use the actual Node readline implementation
with terminal streams, rather than mocked prompt answers. They cover password
cut/yank and confirmation, silent idle editing, fresh visible prompts, and input
following submission in the same chunk. The real CLI runner is held at a fixture
hash promise after both confirmations: Ctrl+Y, text, cursor/history keys,
backspace, and tab remain silent. Success and Ctrl+C, empty-line Ctrl+D, signal,
input-error, and output-error cancellation verify restored raw mode, preserved
password input, expected account writes or their absence, password-service drain,
and database disconnection. Captured output must never contain the fixture
password or its identifying text.

| Check | Result |
|---|---|
| Affected provisioning unit suite | 61 passed |
| Full ordinary unit suite | 169 passed across 11 files |
| Production build with Prisma generation | Passed |
| Non-mutating type-aware lint and full TypeScript | Passed |
| Compiled real pseudo-terminal probe | Nine cases passed; fixture input hidden and original TTY attributes restored |
| Changed-code formatting and whitespace | Passed |

The compiled probe imported the final built prompt class in a real pseudo-terminal
without invoking configuration loading or database code. It verified cut/yank
password entry and independent confirmation, silent editing while deliberately
held pending, and a subsequent visible prompt with no retained secret or echoed
post-submission input. Ctrl+C, empty-line Ctrl+D, SIGTERM, and an input error were
tested both during hidden entry and while pending. All nine children exited
successfully and restored their complete original TTY settings.

Checks ran on Node 24.21.0 in `/tmp/lessonforge-terminal-fix-qssn_ni8`, using an
isolated backend copy excluding `.env*`, generated output, and dependencies, with
a symlink to the existing installed packages. No package installation ran. An
attempt running the full suite alongside build/type checks timed out in two
authentication tests (167 passed); the subsequent full-suite run without those
concurrent checks passed all 169 with unchanged test deadlines. The failed attempt
does not count as passing evidence. Both changed source/test files matched the
final verification copy. The copy, dependency symlink, compiled probe, and its
processes were removed after verification.

Database/service/schema/migration behavior is unchanged. The recorded 10 live
provisioning, 30 live authentication, 39 domain constraint, and 52 HTTP passes are
reused rather than rerun. No real environment file or development database was
accessed, and the real provisioning CLI was not invoked. The reported terminal
password-exposure finding is resolved. The developer provisioning, fresh CI/native
installation, and deployment/performance gaps remain separate from this fix.

## Continuous terminal raw-mode fix on 2026-10-13

The next read-only review confirmed the cut/yank isolation fix but reproduced a
separate OS-level echo window. Node 24's `readline.close()` disabled raw mode on
the real input before the replacement interface enabled it again. Output gates
cannot suppress the terminal driver's echo. The earlier nine PTY probes covered
stable prompt/pending phases and final restoration, not input arriving during
replacement; their passing evidence above is preserved with that limitation.

The prompt owner now enables raw mode once and pipes the real input into a plain
`PassThrough`. Fresh readline editors receive only that stream, which has no
`setRawMode` method. Closing an editor pauses/detaches the bridge editor without
changing the real TTY. The owner alone restores its prior raw mode during final
cleanup, including cancellation, EOF, stream errors, and initialization failure.
Cleanup unpipes and destroys the bridge and removes owner error/abort listeners.
No readline internals or real-input methods are patched by the implementation.
Isolated cut/yank/undo state, silent pending input, synchronous output muting on
submission, confirmation, and exact password whitespace remain intact.

Two new unit cases exercise 30 hidden prompt/idle transitions for each original
raw-mode state. They require exactly one real-input `setRawMode(true)` call while
the owner is active, one restoration call on idempotent final close, and removal
of the stable pipe listeners. The existing real-readline cut/yank, later-visible
prompt, same-chunk trailing-input, held-provisioning cancellation, and connection
cleanup regressions continue to pass.

The reusable fixture-only scripts
[`provisioning.terminal-pty.py`](../backend/test/provisioning.terminal-pty.py) and
[`provisioning.terminal-probe.mjs`](../backend/test/provisioning.terminal-probe.mjs)
run against the compiled prompt class. The pressure case sends fixture secret
input continuously across 500 hidden prompts and their idle replacements,
checks the PTY's `ECHO` flag, and observes public raw-mode calls without delaying
or changing them. No restoration call is allowed during replacement. A final
barrier stops/drains the writer before permitting owner cleanup; captured output
before restoration must contain neither the password nor its identifying text.
The other eleven cases retain cut/yank and independent confirmation, pending
editing, later visible input, Ctrl+C, empty-line Ctrl+D, SIGTERM, and input/output
error coverage during hidden entry and pending work. Every child exited 0 and
restored the complete original TTY attributes.

| Check | Result |
|---|---|
| Affected provisioning unit suite | 63 passed |
| Full ordinary unit suite | 171 passed across 11 files |
| Compiled real-PTY probes, including replacement pressure | 12 passed |
| Production build with Prisma generation | Passed |
| Non-mutating type-aware lint and full TypeScript | Passed |
| Changed TypeScript/JavaScript formatting, Python syntax, and whitespace | Passed |

These checks used Node 24.21.0 and Python 3.14.4 in
`/tmp/lessonforge-terminal-owner-jp_tymag/backend`, copied without `.env*`, generated
output, build output, or dependencies and linked to the existing installed
packages. No packages were installed. Build completed before the checks that
consume generated output; the full unit suite ran without concurrent heavy
checks. All four changed/new implementation and test files matched the final
verification copy. The isolated workspace, dependency symlink, build/probe
artifacts, and probe processes were removed after verification.

The reusable PTY regression requires Python 3, POSIX PTYs/signals, Node 24, and an
up-to-date backend build. From the repository root after a build, run:

```bash
python3 backend/test/provisioning.terminal-pty.py
```

It opens only disposable PTYs and runs fixture-only child processes; it does not
load environment configuration or connect to a database. Stream-error cases
inject public error events rather than physically breaking terminal file
descriptors. This is local Linux/PTY evidence; other host terminal implementations
and fresh CI/native installations remain separate verification gaps.

The real provisioning CLI was not invoked, and no real environment file or
development database was accessed. Provisioning transactions, password services,
schema, migrations, and package lock are unchanged. The recorded 10 live
provisioning, 30 live authentication, 39 domain constraint, and 52 HTTP passes are
reused. Both the retained editing-state issue and the replacement OS-echo window
are resolved by the final implementation; the existing developer provisioning
and deployment/performance gaps remain separate.

## Developer commands and remaining gaps

### Developer provisioning rerun on 2026-10-13

The developer ran the compiled `accounts:provision` CLI against
`lessonforge_dev`, repeating the same teacher and administrator details. The CLI
reported `Teacher account: unchanged.` and `Administrator account: unchanged.`
No password prompts appeared on this rerun. This confirms only the reported
unchanged outcomes; no password values or successful login are established by
this run. Frontend login was pending at the time of this developer run; step 3
implementation and its separate checks are recorded in
[frontend verification](frontend-authentication-verification.md).

Developer-confirmed verification on 2026-10-13 is recorded separately from agent
checks: both migrations applied; Prisma status up to date with exit 0; development
connectivity passed; backend build and compiled startup succeeded; `GET /` returned
`LessonForge API`; unauthenticated `/auth/me` returned 401; Ctrl+C returned promptly;
`sessions:cleanup` deleted 0 invalid records and exited 0. The agent did not access
development or run these commands. This closes the earlier Session application,
compiled development startup, and cleanup-entrypoint evidence gaps.

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
Ctrl+C should await cleanup and return to the shell. No default credentials
exist:

```bash
npm run build --prefix backend
npm run accounts:provision --prefix backend
```

Build generates/compiles only. Provisioning interactively creates only explicitly
supplied missing teacher/admin accounts on the guarded development target; matching
reruns preserve IDs/passwords/roles/names. See
[setup](development-setup.md#safe-local-account-provisioning-step-2) for prompts,
validation, cancellation, and concurrent-conflict behavior.

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

Remaining evidence: a GitHub Actions run containing this implementation;
a fresh native-package installation on the actual runner/host; deployed/browser
cookie and CSRF behavior; realistic KDF latency/memory benchmarking and native
KDF shutdown latency under active/queued hashing work. Neither latency measurement
has been performed; lifecycle/drain-order regression tests are not such a measurement.
The developer has now executed the cleanup CLI as recorded above. Frontend
login/current-user handling is implemented; manual browser verification remains
pending. Public deployment
also requires selected HTTPS same-site origins, trusted proxy/ingress policy,
shared/edge rate limiting, and an hourly cleanup scheduler.
