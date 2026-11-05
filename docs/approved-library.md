# Approved library and durable lesson copying

## Scope and permissions

NestJS implements authenticated approved-library browsing and teacher-only copying.
The existing draft/history/review endpoints keep their contracts and permissions.
A teacher can read another teacher's exact eligible approved revision through the
library, but cannot read that teacher's private drafts or revision history.
Administrators browse the library but cannot create or recover copies.

Eligibility means the lesson's current/latest revision has an APPROVE review and
its derived lifecycle is APPROVED (no draft or draft origin). Approval publishes
that exact immutable revision; there is no extra publication action. Invalid
stored invariants fail closed. Approval of one revision never opens other history.

Shared library responses exclude author identities, reviewer identities and review
feedback. They retain resource citations, full selected source text and resource
IDs/versions. The lesson/revision IDs identify content provenance, not accounts.
Source lessons, submitted history and review decisions remain unchanged by copying.

## HTTP contracts

All endpoints require the existing session authentication and no-store policy,
and share the lesson budget of 120 requests/minute/IP. Copy writes require the
configured Origin, JSON and `X-LessonForge-CSRF: 1`. The copy route uses the existing
128 KiB lesson parser; authentication retains 4 KiB. Content and snapshots are
server-read, never accepted in the copy request.

| Endpoint | Actor / exact input | Success |
|---|---|---|
| `GET /library/approved?limit=20&after=<uuid>` | TEACHER or ADMIN | 200 `{ items: [librarySummary], nextAfter }` |
| `GET /library/approved/:lessonId/revisions/:revisionId` | TEACHER or ADMIN | 200 `{ workflow, revision, approvedAt }` |
| `POST /lessons/:lessonId/revisions/:revisionId/copy` | TEACHER; `{ operationKey, expectedVersion }` | 201 on first committed creation; 200 on matching replay; both return `{ operation }` |
| `GET /library/copy-operations/:operationKey` | TEACHER; current actor's key | 200 `{ operation }`; 404 if no committed mapping exists |

```text
workflow = { lessonId, version, state: "APPROVED", currentRevisionId }
librarySummary = {
  workflow,
  revision: { id, number, title, generationOrigin, submittedAt },
  approvedAt
}
revision = { id, number, content, generationOrigin, submittedAt, sources }
source = { resourceId, resourceVersion, snapshot }
snapshot = { title, subject, grade, sourceReference, contentText }
operation = {
  key,
  source: { lessonId, revisionId, expectedVersion },
  destinationLessonId
}
```

Dates are ISO UTC. `nextAfter` is a UUID or null. Sources are sorted by resource ID.
Library lists order by **lesson UUID ascending**, not approval/submission time.
Default limit is 20, maximum 50; `after` is exclusive and need not exist. Unknown
or repeated list-query keys, malformed UUIDs and invalid limits return 400. Fetch
limit + 1 and emit the last returned lesson ID as nextAfter only if more exist.
Each page is a fresh snapshot; new approvals can sort before a prior cursor.
Restart from the first page for a fresh browse, not a stable cross-page export.

`expectedVersion` is the exact **source Lesson.version** read with the approved
revision, a positive PostgreSQL integer (1–2147483647). Copying does not increment
that version, so a source at the maximum counter can still be copied. The new
destination starts at version 1. Source path UUIDs follow the existing parser:
case-insensitive input normalized to lowercase before binding/comparison.

## Operation identity and recovery

`operationKey` is exactly a 36-character **canonical lowercase UUIDv4**, matching
`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`.
Generate one with `crypto.randomUUID()` for each intentional copy. No whitespace,
uppercase, arbitrary string, another UUID version or invalid variant is accepted.
The body accepts exactly the two documented fields; client content, sources,
identities, origin, provenance, review and timestamp fields are rejected.

Keys are scoped to the authenticated teacher. A successful key binds permanently
to normalized source lesson ID, exact revision ID, expected source version and
destination lesson ID. Same key and all matching parameters returns 200 with the
same mapping; a changed parameter returns sanitized 409, even if it identifies a
missing or ineligible source. Another teacher has an independent namespace and
cannot recover the first teacher's mapping. A new key intentionally creates another
copy of the same approved revision. There is no expiry or cleanup of successful keys.

First creation validates current source approval and version. A matching replay
recovers an already authorized successful operation before checking current source
eligibility/version; it does not perform another copy. Every request still requires
a valid session, teacher role and lookup scoped to that teacher's ownership.
An uncommitted/rolled-back operation has no successful mapping. A failed action
does not reserve its key: the original request may be retried with the same key.

Neither creation nor replay/recovery returns draft content or an editable-state
claim. These are **identity receipts**, not cached creation snapshots. Recovery
works after editing, submission, requested changes, resubmission or approval and
never overwrites the destination. Use the existing owner history endpoint
`GET /lessons/:destinationId/revisions` for current workflow metadata (empty
history is valid before first submission). For DRAFT/CHANGES_REQUESTED, explicitly
load `GET /lessons/:destinationId`; otherwise use exact submitted revision detail.
If the state changes between reads, reconcile again rather than adopting an old
version. A successful copy receipt does not imply the destination is still editable.

After a timeout, abort, invalid success body or infrastructure failure, retain the
**same key and original parameters**. GET recovery is read-only; 404 can mean the
original transaction is still in flight, not that it failed. Repeat the original
POST with that key to serialize with it and either recover or create exactly one
destination. Never generate a new key as an automatic retry or silently adopt a
new source version after 409. A deliberate new copy uses a fresh key. There is no
candidate-search endpoint or title/content matching recovery.

## Storage and transactions

The additive migration `20261105000000_durable_lesson_copies` adds only two nullable
Lesson columns: `copyOperationKey UUID` and `copySourceVersion INTEGER`, plus a
unique `(ownerId, copyOperationKey)` index. The destination row **is** its successful
operation record; identity and content commit atomically without a second table.
The existing write-once `copiedFromRevisionId -> LessonRevision.lessonId` relation
binds the exact source revision and source lesson without a redundant source ID.
Existing lessons remain null/null; older provenance fixtures need no backfill.

SQL checks enforce the key/version pair, positive version, required provenance and
UUIDv4 format. The additive migration extends the identity trigger to protect both
new fields, freezes the destination ID of successful copy operations and rejects
deletion of successful copy mappings. No existing applied
migration is edited. There are no application deletion or expiry paths. Privileged
DDL/TRUNCATE can bypass ordinary row protections; existing deployment-role work
remains outside this increment.

New reads use bounded REPEATABLE READ, READ ONLY transactions (5,000 ms acquisition
and execution limits), including multi-statement relation queries and latest-revision
checks. Copy uses bounded READ COMMITTED transactions in this order:

1. Authenticate/authorize TEACHER and validate request.
2. Acquire a transaction-scoped advisory lock on a PostgreSQL hash of teacher ID
   and key. Competing same-key requests serialize even if naming different sources.
   Hash collisions only serialize unrelated work; the unique index remains the
   database identity constraint.
3. Read the owner-scoped operation mapping after acquiring the lock. Matching
   success returns its receipt; mismatches conflict without source inspection.
4. For a new operation, lock the source Lesson FOR UPDATE, then read its exact
   eligible current/latest approved revision. Hidden/missing targets return 404
   before source-version conflicts. Validate complete stored content and trusted
   retained sources without normalization; persisted corruption returns 503.
5. Compare source version, then insert one new teacher-owned Lesson containing
   exact immutable content and source snapshots, original generation origin,
   copiedFromRevisionId and the durable operation fields. No revision/review/source
   history rows are inserted. Commit, then return the 201 receipt.

Source content/snapshots and MANUAL/AI_ASSISTED origin are retained exactly. There
is no title suffix, text trimming, current-resource lookup, implicit refresh or
resource lock. Retired and older selected sources remain saveable and submittable;
new selection and refresh still require active resources through existing routes.
The copy's first submission is revision 1 and requires its own administrator review.
No source versions/timestamps/history are changed. Partial writes roll back together;
the operation lock releases at transaction end. No network calls occur inside it.

## Errors

Errors retain the existing exact envelope `{ statusCode, message }`; no content,
versions, source eligibility details, key mappings or private database errors are
included. Authentication precedes service work and role checks precede key lookups.

| Status | Meaning |
|---|---|
| 400 | Invalid body, key, IDs, list query or version |
| 401 | Missing/invalid/expired session, including retries/recovery |
| 403 | Wrong role or CSRF/Origin failure |
| 404 | Missing/ineligible exact library target; missing owner-scoped committed recovery mapping |
| 409 | New copy's stale source version, or successful key reused with different parameters |
| 413 / 415 / 429 | Existing body-budget / JSON / lesson-rate protections |
| 503 | Invalid stored invariants, lock/transaction timeout or infrastructure failure |

The shared 409 message remains `Version or state conflict. Reload before trying
again.` Recover/inspect deliberately; a conflict never authorizes changing the
parameters bound to an existing key. `Retry-After` on 503 does not imply failure
before commit. Only retry with the retained key and original parameters.

## Verification

Checks on 2026-11-05 used Node 24.21.0 and already-installed dependencies in
`/tmp/lessonforge-library-20261105-k_jcez10/backend`, copied without `.env*`, generated
clients, existing build output or Git metadata. Dependencies were linked, not
installed. Prisma generation and builds occurred only in this environment-free
copy. Checks ran sequentially to limit memory use.

| Check | Actual result |
|---|---|
| Prisma schema validation | Passed |
| Backend build, including Prisma generation | Passed, including the final production source |
| TypeScript `tsc --noEmit` | Passed |
| Type-aware backend lint | Passed without warnings after the test-helper correction |
| `npm test -- --reporter=dot --no-file-parallelism` | 297 passed across 15 files |
| `npm run test:e2e -- --reporter=dot --no-file-parallelism` | 78 passed across seven files with local socket permission |
| Guarded `npm run test:lessons:db -- --reporter=dot` | 53 passed: 39 existing cases and 14 library/copy cases |
| Guarded `npm run test:constraints -- --reporter=dot` | 39 passed on a separate fresh database |

The new live cases call the actual library/draft/workflow services through two
independent PostgreSQL clients. They cover both browsing roles and teacher-only
copy/recovery, hidden draft/pending/requested-change targets, cross-lesson IDs,
private history restrictions, exact response projections and UUID pagination.
Both generation origins preserve exact content (including title whitespace and
empty materials), older/retired resource snapshots and unchanged complete source
rows through independent submission of the copy.

Operation tests include same-key replay, every bound-parameter mismatch, teacher
namespace isolation, different-key intentional copies, a committed operation whose
response is discarded, and recovery after editing, submission, requested changes,
resubmission and approval. Receipts contain no cached draft or editable-state claim.
All successful mappings remain stable and destination rows are unchanged by replay.

Four new lock-contention cases pause real transactions and verify pg_stat_activity
and pg_blocking_pids before release: matching and mismatched same-key waiters behind
an actual uncommitted insert, different keys waiting on the source lesson, and a
same-key waiter proceeding after the inserting holder rolls back. A separate failure
after an actual insert verifies complete Lesson-row equality, no orphan destination
and no successful mapping, then successfully retries the original key. Database
tests reject identity mutation, deletion of a successful mapping, malformed/pairless
operation metadata and duplicate teacher/key identities. A paused library read
checks READ ONLY/REPEATABLE READ flags while another client approves a lesson,
then compares its earlier snapshot with a fresh read.

Initial failures are retained as evidence: the first unit run passed 293 and failed
four new assertions because mockReturnValue replaced the fixture's event-recording
implementation; corrected fixtures produced the full 297 pass above. The first
lint run warned about a new test helper's unbound method reference; it was corrected.
Sandbox HTTP attempts failed with EPERM socket binding; the unchanged permitted
rerun passed. The sandbox live run failed its identity query before migration or
fixture writes; the permitted run passed the URL, live identity and empty-schema
guards. The first separate constraint run passed 38 and failed one historical
assertion expecting two applied migrations. It now checks the exact three migration
names, and all 39 passed on a newly created empty disposable database. No application
timeouts, production rules or applied migrations were changed to hide failures.

All disposable databases used the installed PostgreSQL 17.11 image with
`--pull=never`, tmpfs data, no mounted volumes and loopback port 5434. Exact container IDs:

- Lesson suite: `27a72beac23a716ae3860ab1b6023a04ed1e06ff433a54d1eeb0652ba3dca696`.
- Initial constraint suite: `041e2d005ab1c2cee87e8685a06d51e28894954f091df8a78120b7ae48653a9e`.
- Final constraint suite: `8b52c6cd4ed2571dd3dde115be9220607662700506cbd3bc91c442c4e442634e`.

Each suite deployed all three tracked migrations only after passing its guards.
The initial failed constraint assertion was corrected using a fresh container;
no existing schema was reset. Each client disconnected before its exact container
was stopped; `--rm` discarded task-only tmpfs data. A final listing filtered to all
three exact IDs returned no containers. The task verification copy and its output
were removed after comparison; installed source dependencies were retained.

Final comparison matched all 101 backend files to the verification copy, excluding
environment files and output. Prettier passed on all nine changed/new TypeScript
files, git diff --check passed, and 96 relative documentation links/anchors were
validated across the nine changed/new Markdown files. Final lint and TypeScript
checks also include the corrected domain migration assertion. The working branch
remains `feat/approved-library-copying` with an empty index; all work is unstaged.

No frontend implementation, rendered/browser/HTTPS checks, new GitHub run, AI
integration, deployment or least-privilege runtime-role verification is established.
No packages were installed, real environment files read, development database
accessed/migrated, or existing container/volume data changed. Both earlier migration
files, package manifests/lockfiles and frontend files are unchanged. No branch
operations, staging, commits or pushes were performed. See the
[frontend handoff](ui/approved-library.md).

## P2 destination-identity correction — 2026-11-05

The reviewed pending migration protected the copy key, owner and provenance but
allowed an unsubmitted copied Lesson's primary key to change before any revision
referenced it. Because receipts derive destinationLessonId from that row, replay
and recovery could then return a different destination ID.

Corrected only the pending `20261105000000_durable_lesson_copies` migration, its
existing identity-mutation regression and this guide. The identity trigger now
rejects an ID change when OLD.copyOperationKey is nonnull, with SQLSTATE `23514`,
constraint diagnostic `Lesson_copy_destination_identity` and message
`Successful copy destination identity is write-once.` Other identity protections
retain their existing behavior. Content saves, version increments and lifecycle
transitions do not change the ID and remain allowed. Earlier applied migrations
are unchanged; this pending migration is not applied to lessonforge_dev.

The regression begins with an unsubmitted copy having no revisions, so no incoming
revision FK can mask the defect. It attempts both direct SQL and Prisma ID updates.
The raw SQL assertion checks native SQLSTATE and the exact trigger message (the
installed Prisma adapter omits the constraint-name diagnostic); the Prisma attempt
must also fail with that message. It verifies the complete original row is unchanged,
the replacement ID is absent, ownership/key/source revision/source version are
preserved, and matching replay and exact recovery return the original receipt.
It then saves ordinary draft content and checks the version increment and receipt.

Fresh checks used Node 24.21.0 and installed dependencies in the isolated copy
`/tmp/lessonforge-copy-id-p2-sthqyte5/backend`, excluding `.env*`, generated clients,
existing output and Git metadata. No packages were installed; Prisma generation
occurred only in that environment-free copy. Checks ran sequentially.

| Fresh correction check | Actual result |
|---|---|
| Guarded native PostgreSQL regression before the migration correction, `npm run test:lessons:db -- --reporter=dot -t 'database protects operation identity'` | Expected failure: the UPDATE succeeded and no trigger error existed; 1 failed, 52 excluded by filter |
| Fresh guarded native PostgreSQL target after correction, `npm run test:lessons:db -- --reporter=dot -t 'database protects operation identity\|copies exact\|recovers a committed lost response'` | 4 passed, 49 excluded by filter |
| `./node_modules/.bin/tsc --noEmit` | Passed |
| `./node_modules/.bin/oxlint --type-aware test/lessons.lessons-db-spec.ts` | Passed without warnings |

The four native cases include the extended identity regression, exact-copy tests
for MANUAL and AI_ASSISTED content, and recovery after editing, submission,
requested changes, resubmission and approval. These are fresh **PostgreSQL 17.11**
results, not PGlite results. Both targets passed the dedicated URL, live database/
user identity and empty-public-schema guards before deploying the three tracked
migrations. No database was reset between runs: the failing reproduction target
was removed and a new container created for the corrected migration.

The first image inspection was blocked by sandbox Docker-socket permissions;
the permitted retry and native runs succeeded. Containers used the installed image
with `--pull=never`, tmpfs data, no mounted volumes and loopback port 5434:

- Reproduction: `f6e29030475c6a5c15ac6c0fe34d3e63294dcb5d2b968c6917b2f49b8142f289`.
- Correction: `98c93e1087e876acc40ef4e81701e4b1270067ddd9b58d7d554d9745603b82e9`.

Each suite disconnected before its exact container was stopped. A final listing
filtered to both exact IDs returned no containers. Focused Prettier and
git diff --check passed. All 101 backend files matched the verification copy;
hash comparison against the correction's starting tree found changes only in the
pending migration, its regression test and this guide. Existing work, earlier
applied migrations and the empty index were preserved on the existing branch.
The task-created verification copy was removed after checks; installed source
dependencies were retained. No packages were installed, real environment files
read, development database accessed, or branch/staging/commit/push actions taken.
The full
297-unit/78-HTTP/53-lesson/39-constraint results above and the review's separate
checks remain prior evidence, not fresh full-suite reruns for this correction.
No fresh HTTP, full unit/build, PGlite, frontend/browser or HTTPS result is claimed.
