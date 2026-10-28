# LessonForge submission and administrator review

## Contract agreed before implementation

This backend-only increment uses the existing Lesson, LessonRevision,
RevisionSource and Review models. Existing draft endpoints retain their contracts.
No schema change, migration, frontend, AI, library browsing/copying or deployment
is included. NestJS owns authorization, completeness, transitions and snapshots.

All routes require session authentication, no-store responses and the existing
lesson rate budget. Writes require JSON, the configured Origin and
`X-LessonForge-CSRF: 1`. Their parser budget is 128 KiB; auth retains 4 KiB.

| Endpoint                                           | Role / exact body                                 | Success envelope                                        |
| -------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| `POST /lessons/:id/submit`                         | Owning TEACHER; `{ expectedVersion }`             | 201 `{ workflow, revision }`                            |
| `GET /lessons/:id/revisions?limit=20&after=<uuid>` | Owner or ADMIN                                    | 200 `{ workflow, items: [revisionSummary], nextAfter }` |
| `GET /lessons/:id/revisions/:revisionId`           | Owner or ADMIN                                    | 200 `{ workflow, revision }`                            |
| `GET /reviews/pending?limit=20&after=<uuid>`       | ADMIN                                             | 200 `{ items: [pendingSummary], nextAfter }`            |
| `POST /lessons/:id/revisions/:revisionId/review`   | ADMIN; `{ expectedVersion, decision, feedback? }` | 201 `{ workflow, revision }`                            |

Exact response fields (no implicit draft, identity, or resource expansions):

```text
workflow = { lessonId, version, state, currentRevisionId }
revisionSummary = { id, number, title, generationOrigin, submittedAt, review }
revision = { id, number, content, generationOrigin, submittedAt, sources, review }
review = null | { id, reviewerId, decision, feedback, decidedAt }
source = { resourceId, resourceVersion, snapshot }
snapshot = { title, subject, grade, sourceReference, contentText }
pendingSummary = { workflow, revision: revisionSummary }
```

`state` is DRAFT, SUBMITTED, CHANGES_REQUESTED or APPROVED. Dates are ISO UTC.
`currentRevisionId`, review, feedback and nextAfter are nullable where applicable.
Content uses the existing draft field names and
[structural bounds](teacher-drafts.md#draft-structure-and-bounds), with all
submission fields required; it excludes sources. Sources are sorted by resourceId ascending. Review feedback
belongs to the exact revision, including when it is no longer current.

Both lists order by ascending UUID, NOT time or revision number. History uses
revision ID; pending uses lesson ID. `after` is exclusive (`id > after`), need not
refer to an existing record, and nextAfter is the last emitted ID only when another
item exists. Default limit is 20, maximum 50. Unknown/repeated query keys and invalid
UUIDs/limits are rejected. History starts empty for an owner's unsubmitted draft;
administrators receive 404 for unsubmitted lessons and never receive editable
draft content. Teachers cannot read another owner's history. Each page is a fresh
snapshot, not a stable cross-page export: new UUIDs may sort before an old cursor,
and pending items may disappear after decisions. Restart pagination for a fresh
queue or complete reconciliation. Revision numbers express chronology.

Feedback accepts a string, or missing/null for approval. REQUEST_CHANGES requires
a nonblank string. Validate the raw string's JavaScript `.length` at at most 4,000
UTF-16 code units, matching existing text validation (an emoji commonly uses two
units), and reject NUL. Trim before storage; blank optional approval feedback
becomes null. Unknown body fields, client identities, timestamps, source snapshots
or replacement submission content are rejected. Decisions are exactly APPROVE or
REQUEST_CHANGES. Versions are positive PostgreSQL integers; exhausted counters
conflict. Every successful mutation increments Lesson.version once.

## Lost-response reconciliation / frontend handoff

Never automatically retry submission or review, including after a timeout, abort,
503, or invalid success body: the transaction may already have committed. Repeated
submissions and reviews return 409, including identical decisions at a current
version. Error bodies contain only `{ statusCode, message }`; they never carry
current content or version. Authorization precedes conflict disclosure.

Before submitting, retain the lesson ID, expected version, confirmed saved content,
origin, sources and baseline current revision ID/number. Obtain the baseline through
history/current-revision detail and confirm its workflow version matches the draft
detail being submitted. With no current revision, the baseline number is zero.
Unsaved editor text is not included by the submit endpoint.

If the response is lost, read this lesson's history from the first page and, as
needed, every page. Find baseline number + 1 and load that exact revision ID. Compare
its immutable content, origin and sources with the retained submitted candidate.
Compare sources by resourceId; draft selection order can differ from response order.
A review may already exist or a later revision may be current: neither means this
submission failed. Read feedback on the identified revision, and use workflow
metadata only for the latest state/version. Never use currentRevisionId alone to
identify the attempted submission and never resubmit into a later editable draft
as an automatic recovery action. Subsequent review/resubmission cannot erase the
earlier revision. Identical matching concurrent attempts establish the persisted
outcome, not which HTTP request won.

If the baseline was not retained, inspect history explicitly; matching content alone
can be ambiguous when revisions repeat. If no matching revision is visible, the
request may still be in flight. A read cannot prove an uncommitted request failed.
Keep the write uncertain, refresh deliberately, and require explicit reconciliation
before adopting a version or making another write. Any retry must retain its original
expected version unless the user intentionally starts a new action. For lost review
responses, reload the exact revision: the immutable review identifies the winning
decision/reviewer; a different winner must be shown as a conflict.

After CHANGES_REQUESTED the owner can use existing draft detail/save/source routes.
After SUBMITTED/APPROVED those editable-detail routes still return 409. Read history
instead. Administrators use revision detail and must never load a mutable draft.

## Database consistency and transitions

Every workflow GET uses a short REPEATABLE READ, READ ONLY interactive transaction
with maxWait/timeout both 5,000 ms. Its first statement sets READ ONLY before data
queries. This gives authorization, lesson metadata, current review, latest-revision
checks, history and Prisma relation queries one PostgreSQL snapshot, even when
Prisma emits multiple statements. No write locks are needed for reads.

Mutations use READ COMMITTED with the same bounds, lesson FOR UPDATE first, then
fresh persisted ownership/state/current/latest/version checks. Existing save/source
operations retain their lifecycle-before-version ordering. Resource selection/refresh
continues lesson then resource locking. Submission/review consumes trusted stored
snapshots without refreshing or requiring active/current resource versions.

Submission validates complete bounded content, at least one of up to five unique
trusted sources, and positive integer section timings summing to the total. Materials
is required but may be empty. Insert the next numbered revision and all sources,
move the pointer, clear draft/origin using SQL NULL, increment version, commit.
Sources are inserted only during this transaction; no route appends to history.

Review requires the exact current/latest unreviewed revision. Insert one immutable
review. REQUEST_CHANGES restores draft content, origin and source snapshots from
that revision; APPROVE keeps draft/origin absent. Both leave the pointer unchanged
and increment version. Owner/copy provenance and all historical rows stay unchanged.
No network calls, decision editing, withdrawal, reopening or automatic retry occurs.

For review mutations, after role authorization and the locked authorized lesson
load, validate target revision existence and membership in that lesson before
reporting lifecycle/version conflicts. Unknown and cross-lesson targets return
404 with fresh or stale versions in SUBMITTED, APPROVED and CHANGES_REQUESTED.
An existing same-lesson target still returns 409 when noncurrent, already reviewed,
or supplied with a stale version. Missing/unauthorized lessons are rejected before
target lookup; teachers cannot reach review database work. Error bodies remain
sanitized and none of these failures writes a review or changes a lesson.

Invalid input/completeness/feedback is 400; authentication is 401; role/CSRF is 403;
unknown/foreign lesson or unknown/cross-lesson revision is 404; stale versions,
noncurrent/already-reviewed targets, illegal states and repeated actions are 409.
Existing 413/415/429 apply. Broken persisted invariants and unexpected database
failures are sanitized 503. Recognized unique review/revision-number conflicts map
to 409 after rollback. Every partial write rolls back, including draft, timestamps,
version, pointer, revision, sources and review.

## Verification

Checks used Node 24.21.0 and installed dependencies in the isolated backend copy
`/tmp/lessonforge-review-20261028-k58yn831/backend`, excluding all `.env*`, existing
build output and Git metadata. No packages were installed. Historical draft fixture
tests remain separate from these tests of actual submission/review service calls.

| Check                                                                       | Actual result                                                          |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Backend TypeScript (`tsc --noEmit`) and type-aware lint                     | Passed                                                                 |
| Backend build, including Prisma generation                                  | Passed                                                                 |
| Unit suite with serialized files (`--no-file-parallelism`)                  | 264 passed across 14 files                                             |
| Database-free HTTP suite, with local socket permission and serialized files | 71 passed across six files                                             |
| Guarded disposable PostgreSQL lesson suite                                  | 36 passed, including existing 13 draft tests and 23 new workflow tests |
| Changed TypeScript formatting and `git diff --check`                        | Passed                                                                 |

Final comparison matched all 95 backend files in the verification copy to the
workspace, excluding environment files. All 88 relative documentation link targets
were validated. Schema, migrations, manifests and lockfiles are unchanged. Work
remains unstaged on `feat/lesson-submission-review`; no branch creation, switch,
reset, merge, deletion, commit or push was performed.

The new live cases include ten observed lesson-lock waits: save before submission;
save/select/remove/refresh/submit behind submission; and four same/opposing decision
pairs using two administrator identities. Each checks PostgreSQL lock activity and
the holder PID before release, then requires a specific 409 loser. Rollback cases
inject failure after actual revision, partial/full source, review and lesson writes,
comparing complete persisted rows, timestamps, counters and history. Three read
tests pause history/detail/queue inside a verified read-only REPEATABLE READ
transaction while another client requests changes, saves and resubmits. They assert
the earlier coherent snapshot and a later fresh read. Full history assertions retain
feedback, sources (including retired selections), origin and provenance through
refresh/resubmission/approval. These use a provenance fixture, not an AI integration.

The initial parallel unit run passed 261 tests and timed out three existing tests
(controller setup, auth shutdown, native Argon2). No timeouts were changed. Its new
workflow tests all passed; a serialized-file rerun is recorded separately below.
The sandboxed HTTP run was blocked by EPERM socket binds; the permitted rerun passed.
The first live invocation failed the identity query before migration/fixture writes;
the permitted invocation passed the dedicated URL, identity and empty-schema guards,
then deployed only the two unchanged tracked migrations. It never loads `.env` or
falls back to `DATABASE_URL`.

The task container used PostgreSQL 17.11, `--pull=never`, tmpfs data, no mounted
volumes, and loopback port 5434. Its exact ID was
`1c67e9696b2d2ad47fa72b24ec22def12bcc06c15254b1c7fe2eb4502a9ce1b7`.
Tests disconnected before that exact container was stopped; `--rm` discarded its
tmpfs data. Final removal was checked separately because Docker initially still
listed the container immediately after stop.
The existing development container/volume and port 5433 were untouched.

No frontend implementation or rendered/browser/HTTPS checks, new GitHub CI run,
least-privilege deployment-role verification, library browsing/copying, AI integration,
deployment or development-database verification is established by this work.

## Review-target contract correction — 2026-10-28

Moved review-target existence/membership validation into the locked mutation
helper, after the authorized lesson load and before allowed-state/version conflicts.
Review still requires the exact current unreviewed revision. Submission behavior,
authorization, transaction bounds, immutable history and source snapshots are
unchanged. The correction touches only the workflow service, its unit tests,
affected HTTP tests, the live lesson suite and this guide; earlier unstaged work
was preserved on the existing `feat/lesson-submission-review` branch.

Before the fix, the new 12-case unit matrix reproduced ten incorrect 409 responses;
only the two fresh SUBMITTED cases returned the required 404. The corrected unit
and live cases combine unknown/cross-lesson targets, fresh/stale versions and
SUBMITTED/APPROVED/CHANGES_REQUESTED states. Unit tests assert lesson-lock and
authorization/existence ordering and no write calls. Live tests compare complete
lesson/revision/review/source rows, versions, timestamps and provenance for both
the target lesson and the other lesson after each rejected request. Existing
same-lesson targets retain 409 for stale versions, noncurrent revisions and
already-reviewed revisions. HTTP tests confirm sanitized 404/409/503 bodies.

Fresh checks used installed Node 24.21.0/dependencies in
`/tmp/lessonforge-review-target-2xd_luyp/backend`, copied without `.env*`, generated
clients, build output or Git metadata. Prisma generation occurred only in that
copy. From its backend directory, the actual commands/results were:

| Check | Actual result |
|---|---|
| `npm test -- src/lessons/lesson-workflow.spec.ts src/lessons/lessons.spec.ts --reporter=dot --no-file-parallelism` | 105 passed across two files |
| `npm run test:e2e -- test/lesson-workflow.e2e-spec.ts test/lessons.e2e-spec.ts --reporter=dot --no-file-parallelism` | 12 passed across two files on the unchanged retry, with local socket permission |
| `npm run test:lessons:db -- --reporter=dot`, with dedicated disposable URL/acknowledgement | 39 passed, including all earlier 36 lock-wait/rollback/history/snapshot cases and three new state-matrix cases |
| `npm run lint` | Passed |
| `./node_modules/.bin/tsc --noEmit` | Passed |
| `npm run build` | Passed, including Prisma generation |
| Installed Prettier check on the four touched TypeScript files; root `git diff --check` | Passed |

The first affected HTTP attempt passed 11 tests and timed out one existing setup
hook at ten seconds. The same command run alone passed all 12 in 14.71 seconds;
no timeouts, fixtures or application code were changed between attempts. Full
ordinary unit/HTTP suites were not rerun for this correction; the earlier full-suite
results above remain historical. The complete live lesson suite was rerun.

The fresh database used the existing dedicated port 5434 URL, live identity and
empty-schema guards before deploying the two unchanged tracked migrations. Its
PostgreSQL 17.11 container used `--pull=never`, tmpfs data and no mounted volumes,
with exact ID
`a7438974f2cf80e9749bd751e13e6aeeeaa4290a3ab2d9c06052ba226ede1e3b`.
The suite disconnected before this exact container was stopped. Docker initially
listed it as Dead during removal; a later exact-ID listing returned no matches.
Existing containers, volumes and the development database were untouched.

Final source comparison matched all 95 backend files to the verification copy,
excluding environment files. No packages were installed, real environment files
read, schema/migrations/manifests/lockfiles changed, branch operations performed,
or changes staged, committed or pushed. Browser/HTTPS/frontend and deployment
verification remain outside this correction.
