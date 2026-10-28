# LessonForge teacher drafts

Current backend submission/review support is documented in
[workflow contracts and verification](lesson-review.md). The original draft
implementation scope and historical evidence below remain unchanged. Existing
draft endpoints still expose only editable DRAFT/CHANGES_REQUESTED lessons;
use the new revision/history endpoints for pending/approved lessons and feedback.

## Implemented scope

Teachers can create, list, open and save their own incomplete manual drafts, and
select/remove/explicitly refresh resource snapshots. NestJS owns permissions,
validation, ownership, snapshot capture and transactions. No schema or migration
change was needed: the agreed `Lesson.draftContent` JSONB already holds content
fields plus the backend-owned `sources` array. Saving never inserts a
`LessonRevision`, `RevisionSource` or `Review`.

Submission completeness validation, submission/review/resubmission, approved
library/copying, AI and deletion endpoints are not implemented here. Accepting a
draft is not evidence that it could be submitted. Existing sources remain usable
after edits/retirement; their future submission eligibility remains the agreed
policy, not a claim of an implemented submission workflow.

## HTTP contracts

Every endpoint requires an authenticated `TEACHER`. Ownership is fixed from the
authenticated principal, never a request field. Administrators cannot use these
routes, including reads. Existing credentialed transport, exact-origin CORS,
CSRF header, no-store responses, safe error filter and deadlines apply. Lessons
have a separate bounded 120 requests/minute/IP budget; authentication remains on
its existing budget. No automatic write retries occur.

| Endpoint | Exact JSON body | Success |
|---|---|---|
| `POST /lessons` | `{ "content": { ...draftFields } }` | `201`, draft detail at version 1, manual origin, no selected sources |
| `GET /lessons?limit=20&after=<uuid>` | None | `200`, `{ items: [summary], nextAfter: uuidOrNull }` |
| `GET /lessons/:id` | None | `200`, owned editable draft detail |
| `PUT /lessons/:id` | `{ "expectedVersion": 1, "content": { ...draftFields } }` | `200`, saved detail with incremented lesson version |
| `POST /lessons/:id/resources/:resourceId/select` | `{ "expectedVersion": 1 }` | `200`, captured latest active resource snapshot and incremented lesson version |
| `POST /lessons/:id/resources/:resourceId/remove` | `{ "expectedVersion": 1 }` | `200`, selection removed and lesson version incremented |
| `POST /lessons/:id/resources/:resourceId/refresh` | `{ "expectedVersion": 1 }` | `200`, one selected snapshot replaced from latest active resource; lesson version incremented |

List pagination uses ascending UUID keysets; default 20, maximum 50. Only owned
editable drafts are listed. Summaries contain exactly `id`, `title` (possibly
blank), `version`, `state` (`DRAFT` or `CHANGES_REQUESTED`), `createdAt`, `updatedAt`.
Detail adds exactly `content`, `generationOrigin`, `sources`. Dates use ISO UTC.
`content` excludes source metadata; a save replaces all editable content fields,
including removing fields omitted from that request. It preserves origin and
every retained selection exactly. Reads do not change versions.

Each selection is `{ resourceId, resourceVersion, snapshot }`. The full content
snapshot contains exactly `title`, `subject`, `grade`, `sourceReference`,
`contentText`. Resource ID/version come from the locked resource. Clients supply
only its UUID in the route; client sources, snapshots, owner IDs, origin, lifecycle
or version metadata are rejected, including inside content. Five selections are
allowed, each resource at most once. Selecting an existing selection, removing or
refreshing an absent selection, or exceeding five returns `409`. Selecting or
refreshing a retired resource returns `409`; missing resource returns `404`.
Removal works without consulting current resource availability. Explicit refresh
increments the lesson version even if the resource version has not changed.

Errors: `400` invalid request/ID/query/shape/types/limits, `401` missing session,
`403` role/CSRF failure, `404` unknown/foreign lesson (without existence disclosure),
`409` stale version/noneditable lifecycle/selection conflict, `413` HTTP body too
large, `415` non-JSON, `429` rate limit, `503` sanitized infrastructure failure.
Conflict/error bodies contain only safe status/message, never current draft
content or versions; owners explicitly load detail to reconcile. Expected versions
are positive PostgreSQL integers; exhausted counters cannot mutate.

## Draft structure and bounds

All draft fields and nested fields may be absent; empty strings, arrays and
objects are valid drafts. Null and unknown fields are rejected at every level.
Text is preserved without trimming, interpreted as plain text and never fetched
or rendered as markup. The entire serialized content has a 64 KiB UTF-8 limit;
lesson mutation bodies use the existing resource-sized 128 KiB parser, while auth
retains 4 KiB. Captured snapshots are separate from the client content budget and
bounded by resource limits and five selections.

| Field | Draft type and limit |
|---|---|
| `title` | String, maximum 200 characters |
| `subject`, `grade` | If present, exactly `Mathematics`, `Grade 4` |
| `durationMinutes` | Whole number 0–1,440 |
| `learningObjectives` | Up to 30 strings, 1,000 characters each |
| `materials` | Up to 30 strings, 500 characters each; `[]` means no additional materials |
| `introduction`, `assessment` | Objects containing optional `text` (4,000 characters) and `durationMinutes` (whole number 0–1,440) |
| `activities` | Up to 30 objects containing optional `teacherTasks`, `learnerTasks` (4,000 characters each) and `durationMinutes` (whole number 0–1,440) |
| `differentiation` | Object containing optional `learnerSupport`, `extensionActivities` (4,000 characters each) |

Character limits use JavaScript UTF-16 length; NUL is rejected. Draft validity does
not enforce nonblank fields, positive timings, timing sums, minimum sources or
submission completeness. Those existing specification requirements remain pending
submission work; the editor explicitly says so. Frontend structure checks validate
API responses; they do not replace NestJS input validation or permissions.

## Transactions and concurrency

Each content/source mutation takes `FOR UPDATE` on the owned lesson in one
transaction, rereads ownership and the current revision/review, checks editable
lifecycle, checks expected `Lesson.version`, then writes using an additional atomic
`updateMany` owner/version predicate. A draft is editable only when present with
an origin and either no current revision, or a current `REQUEST_CHANGES` review.
Pending/approved states reject writes. No lifecycle endpoint is added; fixture
tests establish these defenses against existing stored states only.

Selection and refresh acquire a resource `FOR SHARE` lock after the lesson lock,
then read the resource's latest committed fields and active status. Resource
management takes `FOR UPDATE`, so resource edits and retirement serialize with
capture. If retirement wins first, capture rejects and rolls back; if capture wins
first, its snapshot remains usable after retirement. Content saves and removal do
not reread resources. All mutations increment the same lesson version, preventing
source changes from bypassing a content-save precondition. Transactions have
five-second acquisition/execution bounds and no external calls or retries.

Future submission/review services must use the same lesson lock first, and acquire
resource locks afterward when needed. This implementation does not claim to
coordinate with an unimplemented lifecycle service or arbitrary privileged SQL.
Existing database protections, identity fields, submitted content and provenance
are preserved. A failure after a write rolls back content, sources, timestamps and
version together.

## Frontend reconciliation and identity

The accessible draft list/editor uses labeled native controls, fieldsets, visible
focus, status/alert regions, text rendering and explicit buttons. Objectives and
materials use one entry per line; activities remain ordered. Source actions save
independently of entered content and preserve it. No automatic create/save/source
write retry occurs, including on timeout, cancellation, invalid success response
or 500/502/503/504. Those outcomes may already have committed.

Load latest result keeps entered content, draft identity, base version and current
selection baseline unchanged. For an uncertain known draft, it loads that exact
draft's detail; list loads cannot acknowledge it. For an uncertain creation with no
known ID, it loads the list. A list read enables searching but does not enable
candidate acknowledgement. Each `inspectCreation()` first clears the previous
candidate, `latest`, and `reconciled`; only a successful current, matching-ID detail
response enables acknowledgement. A failed inspection stays blocked, and a stale
success/failure after authentication pause or identity disposal cannot restore an
old candidate. The teacher can retry a candidate inspection without first adopting
anything. Compare its content, then explicitly acknowledge.

If no saved draft matches after checking the relevant list pages, a separate
**I found no matching draft; allow a new create** choice releases creation
uncertainty without adopting a draft or sending a write. It requires a successful
fresh list reconciliation and is invalidated by starting any candidate inspection,
including one that fails. Reconcile the list again before choosing this path after
a failed inspection. Creation has no idempotency key; a deliberate new create
can duplicate a committed creation whose result was lost.
Choosing **Use displayed draft, version, and selections with my entered text**
explicitly adopts identity/version/selections while retaining the entered content.
This is a deliberate whole-content replacement on the next save, not a field merge.
Conflicts block further writes until this explicit choice or closing the editor.
Failed reconciliation clears its earlier eligibility; it never silently rebases.

Confirmed logout/identity changes unmount and clear the keyed workspace (user ID,
role and absolute session expiry). Unconfirmed authentication/logout retains
entered work and disables controls. The store also pauses, aborts and invalidates
pending responses; a pending write becomes uncertain and must be reconciled after
session recovery. Late successes/failures cannot affect a newer workspace.
Read controls cannot overlap writes. No local/session storage is used for drafts.

## Browser-report investigation and focused usability corrections

The 2026-10-21 developer report described readable resource material, an
uneditable introduction, absent save/select/remove/refresh controls, and content
disappearing after page refresh. The checkpoint `3fabe39` on
`feat/lesson-drafts` was inspected first; the working tree was clean. No development
database, browser session or real environment configuration was accessed.

Tracing the checkpoint's JSX, stores and request helpers established these
conditions before UI changes:

| Location/state | Content and controls | Page refresh |
|---|---|---|
| Standalone **Curriculum resources** (`ResourcesPanel`) | Resource material is plain text. Teachers have browsing controls; resource editing belongs to administrators. This panel neither opens a lesson nor exposes lesson save/select/remove/refresh. | Resource detail selection is local UI state; it must be reopened. |
| **My lesson drafts**, no draft open (`form === null`) | The introduction/editor and its actions are absent until New manual draft or Open draft sets the form. Browsing a resource does not set it. | A fresh workspace starts with no open draft and loads summaries only; saved drafts must be explicitly reopened. |
| New unsaved lesson | Lesson introduction and other fields are editable. Save creates the draft; resource selection requires that saved lesson ID. The checkpoint save button was below the long form. | Unsaved content is memory-only and is not restored. |
| Open saved lesson | Content save is available; Select appears after browsing an active resource within the editor. Remove/refresh appear for each selected snapshot. Source actions save snapshots separately and retain entered lesson text. | Reopening fetches saved content and snapshots from the API, rather than adopting a version automatically. |
| Authentication unconfirmed, or request pending | The outer session fieldset or pending-request fieldset disables controls. Conflicts/uncertain writes block writes pending explicit reconciliation; they preserve entered content. | These protections must not be removed to make controls appear editable. |

These conditions explain how the reported symptoms can occur without database
data loss. They do not establish which heading the developer actually clicked,
whether the previous content had a confirmed save, or whether a disabled browser
control had another cause. A clarification was requested; the exact rendered
session has not been reproduced. The request/state fixture separately verifies
that resource browsing sends no lesson writes, saved introductions survive a
workspace recreation and explicit reopen, and unsaved changes are not persisted
by selection/removal/refresh. This fixture is not evidence about development data.

The focused UI corrections make the existing workflow explicit:

- The resource browser identifies itself as read-only and links to My lesson drafts.
- With no lesson open, the draft workspace explains New manual draft/Open draft,
  reopening after refresh, and the saved/unsaved distinction. List buttons say
  Open draft (or Inspect possible saved draft during creation recovery).
- The editor places Save draft content beside its heading, labels the lesson
  introduction as editable, and links directly to it and the source controls.
- A saved/unsaved indicator compares content structurally, ignoring object key
  order and omitted optional values. Source writes do not imply lesson text was saved.
- Available active resources and retained selected snapshots are labeled separately
  as read-only source material; empty-selection text explains when controls appear.
- A native `beforeunload` warning is requested for unsaved content, pending writes,
  or uncertain writes. Browser policy/user interaction determines whether a dialog
  appears. It does not save content, retry a write, or guarantee recovery after reload.

No backend permissions, endpoints, validation rules, version checks, snapshot
semantics, schema or migrations changed. This is a workflow clarification, not a
broader interface redesign or evidence of submission completeness/workflow support.
If My lesson drafts is entirely absent for a confirmed teacher, first verify that
the frontend process is serving this branch/checkpoint and restart that process
privately as needed. A browser running older compiled code has not been ruled out
by this source-only investigation.

## Local checks and browser checklist

No dependency installation is required. In a checkout/copy without real `.env*`
files, these repository-root commands use installed tools; the build generates
Prisma before lint/type/tests. They do not contact a database:

```bash
nvm use
npm run build --prefix backend
npm run lint --prefix backend
./backend/node_modules/.bin/tsc --noEmit --project backend/tsconfig.json
npm test --prefix backend
npm run test:e2e --prefix backend
npm test --prefix frontend
npm run lint --prefix frontend
npm run typecheck --prefix frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm run build --prefix frontend -- --webpack
```

HTTP tests need permission to bind local test-server ports. Frontend tests use
mocked fetch and the installed Node test runner. The Webpack command is explicit
fallback build evidence; it does not establish the default Turbopack build.

Use the [existing local startup commands](curriculum-resources.md#local-startup-and-manual-browser-verification)
with privately configured accounts/database when the developer chooses to test the
browser. These are developer-run checks, not agent access to development data:

1. Sign in as teacher; create an incomplete draft with only title, save, reload the
   page, and reopen it. Check persistence, version increment and no submitted
   revision. Save zero/blank timings and empty materials. Add activities and confirm
   the labels, ordering and text fields work by keyboard and at narrow/zoomed sizes.
2. Select an active original fractions demonstration resource, read its full
   retained snapshot, enter unsaved content, then select/remove/refresh resources.
   Confirm selection actions retain unsaved content and content saves retain
   snapshots. Check five-resource and duplicate-selection limits via direct API.
3. In an administrator tab, edit a selected resource. Ordinary content save must
   retain the old snapshot. Explicit refresh must capture its new version/text.
   Retire it: existing selection remains readable/saveable, active browse excludes
   it, refresh/new selection fails without loss, removal remains possible.
4. Open one draft/version in two tabs. Save content in one; save or change sources
   in the other. Expect conflict, retained entered text and unchanged base version.
   Load latest, compare content/full snapshots, explicitly adopt version/selections,
   then deliberately save. Verify no silent overwrite or automatic retries.
5. Block requests or override mutation responses to 500/502/503/504, including a
   committed write with lost response. Creation must not retry automatically;
   reconcile list/pages/detail explicitly. Save/source uncertainty must reconcile
   exact detail. Failed reads/list browsing must not enable known-write
   acknowledgement; entered content and base version stay unchanged until chosen.
6. With requests pending, attempt logout and account switching; simulate failed
   logout/auth restoration. Verify paused controls, retained work on unconfirmed
   sessions, and no late result/error leaks after confirmed identity change.
7. Another teacher's known UUID must return 404 for detail/content/source changes;
   administrator must receive 403 on all draft routes. Forged owner/source/snapshot
   fields, unknown/nested fields and wrong types/context must fail through direct
   requests. Bypass UI constraints to verify content budgets and backend rejection.
8. Enter literal `<script>`/HTML and citation URLs; they must remain text without
   execution or outbound fetches. Inspect no-store/credentialed CORS and CSRF
   rejection. Exercise focus, keyboard, status/error announcements and screen reader.

The new draft browser checklist is pending. Resource browser checklist completion
was **developer-reported on 2026-10-19**; see the
[separate resource evidence](curriculum-resources.md#developer-browser-report-2026-10-19).
That report does not establish previously pending automated rendered-component
tests, HTTPS/cookies, or deployment readiness.

For the corrections, repeat the checklist with special attention to opening a
draft after refresh, editing the labeled lesson introduction, the top save action,
saved/unsaved status across source actions, and the browser's unload warning.
For uncertain creation, inspect A successfully, fail inspection B, and confirm
that A disappears and acknowledgement/adoption remain blocked. Repeat with late
responses across Check session/logout. After a fresh list read with no match,
the separate no-match choice must not send a POST automatically.

## Correction verification 2026-10-21

Started on `feat/lesson-drafts` at developer-created checkpoint `3fabe39`
(`wip: add teacher drafts pending review corrections`) with a clean working tree.
The follow-up status/diff inspection requested during the task confirmed five
partial implementation/test changes and no schema, migration, package or backend
production-service change. No commit, push, package installation, real `.env` read,
development-database connection or applied-migration edit was performed.

The corrections touch `frontend/src/lib/lessons-state.ts`,
`frontend/src/components/lessons-panel.tsx`,
`frontend/src/components/resources-panel.tsx`,
`frontend/test/lessons-state.test.mjs`,
`backend/test/lessons.lessons-db-spec.ts`, this guide and the roadmap status note.

New frontend cases cover A succeeding then B failing (with old candidate and
eligibility cleared before the request), unsuccessful/wrong-target inspection,
stale successes and failures across authentication pause/disposal, explicit
version adoption, separate deliberate no-match recovery, and the distinction
between read-only browsing, editable introduction, source writes, content saves,
and explicit reopening after workspace recreation. They use the actual API
helpers/shared credentialed transport with mocked fetch for the full round trip.

The corrected live lifecycle case is parameterized over save/select/remove/refresh.
It obtains the holder's PostgreSQL PID and observes a waiting lesson `FOR UPDATE`
query whose `pg_blocking_pids()` contains that PID, while the request remains
unsettled. Only then does it release the fixture gate to commit the lifecycle
change. Each waiting mutation must reject specifically with a state conflict,
and the complete lesson row must equal the committed transition result, including
version/timestamps/draft/origin. The fixture transition intentionally clears the
draft for submission; the rejected request must not restore or replace it. The
submitted revision and full source snapshot must also equal their fixture values
as returned through Prisma. This strengthens test evidence and does
not add a lifecycle endpoint or submission validation.

Checks used installed Node 24.21.0 and dependencies in
`/tmp/lessonforge-draft-corrections-20261021-3wxorn51`; source/configuration were
copied with all `.env*`, existing output and Git metadata excluded, and installed
dependencies were linked without installation.

| Correction check | Actual result |
|---|---|
| Targeted frontend lesson API/state tests | 17 passed |
| Full frontend request/state suite (`npm test`) | 82 passed |
| Backend `tsc --noEmit` and `npm run lint` | Passed, no lint warnings |
| Frontend `npm run typecheck` and `npm run lint` | Passed, no lint warnings |
| Fresh guarded `npm run test:lessons:db -- --reporter=dot` | 13 passed, including all four observed lesson-lock waits |
| Frontend `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm run build -- --webpack` | Passed with permission: compilation, TypeScript, static pages and build tracing |
| Changed-source Prettier, whitespace and local documentation links/anchors | Passed |

The sandboxed Webpack attempt stopped with `Could not parse output from
TypeScript's --showConfig`. Its permitted retry encountered transient Google Fonts
DNS failures, retried those downloads, then completed successfully. No production
font configuration or build command was changed. All five changed application/test
files matched the isolated verification copy after the final checks.

The sandboxed live invocation failed its identity query before migration or
fixture writes. The permitted retry passed the dedicated URL, live database/user
identity and empty-public-schema guards, deployed only the tracked migrations and
passed on PostgreSQL 17.11. The container was created with `--pull=never`, tmpfs
data, no mounted volumes and loopback port 5434. Its exact ID was
`ccb5e09a128c509e088d629aba4bdb21c1b01b629328af71d6d6afacf8b0bc10`
(`lessonforge-draft-corrections-20261021-3wxorn51`).
Tests disconnected before that exact container was stopped. `--rm` removed it and
an ID-filtered container listing returned no matches. Existing Docker data was
untouched.
After the final source comparison, the correction verification copy and its build
output were removed. The installed source dependencies were retained.

Backend production code and HTTP contracts did not change. The 2026-10-19 unit,
HTTP and backend-build results below are reused evidence, not claimed as rerun
for this correction. Live tests remain opt-in outside ordinary CI. A new GitHub
run, default Turbopack build, development-database outcome, rendered browser test
or HTTPS verification is not established by these results.

### Additional rendered-test tooling

Installed-package inspection again found no Playwright, Puppeteer, React Testing
Library, JSDOM, Happy DOM or React Test Renderer. React/React DOM and the Node
runner support the existing request/state tests, but do not supply a browser/DOM
for hooks, nested disabled fieldsets, actual focus, reload or unload-dialog tests.
No packages or browser binaries were installed.

If approved in a separate tooling task, these developer-run commands add
Playwright to the frontend manifest/lockfile and download Chromium:

```bash
npm install --save-dev --prefix frontend @playwright/test
cd frontend
npx --no-install playwright install chromium
```

Then add database-free browser fixtures that mock `/auth/*`, `/lessons*` and
`/resources*`, retaining mock saved data across reloads. Exercise the actual teacher
resource browser versus editable introduction, visible save/source actions,
disabled controls during unconfirmed auth and pending requests, stale deferred
responses, failed B after successful A, no-match recovery, saved/unsaved status,
explicit reopen after reload and the native unload warning after user interaction.
Also verify keyboard and screen-reader behavior. Those rendered outcomes remain
pending; the 2026-10-19 developer-reported resource checklist is separate manual
evidence and does not establish the new lesson checks or HTTPS readiness.

## Verification evidence — 2026-10-19

Checks used installed Node 24.21.0 and existing dependencies in an isolated copy
at `/tmp/lessonforge-drafts-20261019-zttunbka`; real `.env*`, existing build output
and Git metadata were excluded. Dependencies were linked, never installed.
Database-free checks substituted database access. All 21 changed application files
matched the verification copy in the final comparison. No packages were installed,
real `.env` files read, `lessonforge_dev` contacted, existing Docker data changed,
schema/applied migrations edited, commit created or push performed.

| Check | Actual result |
|---|---|
| Backend `npm test -- --reporter=dot` | 206 passed across 13 files in the final isolated normal run |
| Backend `npm run test:e2e -- --reporter=dot` | 65 passed across five files, with local socket permission |
| Backend `npm run test:lessons:db -- --reporter=dot` | 10 passed on fresh guarded PostgreSQL 17.11, with loopback access permission |
| Backend TypeScript and lint | Passed; final lint had no warnings |
| Backend `npm run build` | Passed, including Prisma generation; repeated on final source |
| Frontend `npm test` | 78 passed, including 13 new lesson request/state cases and the existing resource/auth cases |
| Frontend lint and route typegen/TypeScript | Passed; final lint had no warnings |
| Frontend `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm run build -- --webpack` | Passed with permission, including final source compilation, TypeScript, static generation and build tracing |
| Changed-source Prettier, whitespace, documentation links/anchors | Passed |

One concurrent final-check run timed out two existing backend authentication
tests (module teardown at five seconds, native Argon2 at twenty seconds); its other
204 tests passed. No timeout or production code was changed to hide this. A
serialized-file run passed all 206, then the normal unit command run without the
other checks passed all 206 in 19.33 seconds. The frontend lint initially reported
three unused fixture destructuring variables; these were removed, and final lint
and all 78 tests passed.

The sandboxed frontend Webpack build failed with `Could not parse output from
TypeScript's --showConfig`; the permitted retry and final-source repeat passed.
The default Turbopack build was not rerun; the earlier resource-task restriction
remains separate evidence. No new GitHub Actions run, clean install, automated
rendered/keyboard/screen-reader interaction, deployed HTTPS/session verification,
least-privilege database-role verification or staging readiness is claimed.

The first live invocation without opt-in variables refused before any database
access. With explicit variables, the sandbox blocked the identity query before
migration/fixture writes. The permitted retry passed the URL, identity and
empty-schema guards, deployed the tracked unchanged migrations and passed all
10 live tests against fresh PostgreSQL 17.11. Independent clients exercise real
ownership/persistence, competing content and source mutations, coherent resource
capture during edit/retirement, an observed resource-lock wait, retained snapshots,
locked lifecycle checks, immutable fixture history, and post-write rollback.
Fixture inserts of submitted/reviewed history do not implement those workflows.

The sandbox initially blocked all HTTP tests with `listen EPERM`. The permitted
database-free run passed 65 tests across five files, including five lesson HTTP
cases. Initial unit checks passed 204 tests and frontend checks passed 76 tests;
the expanded final results are in the table above. These are request/state tests, not
rendered UI interaction. Installed tooling has no Playwright, Puppeteer, testing
library, JSDOM, Happy DOM or React Test Renderer; no package was installed. Proposed
optional rendered tooling commands remain in the
[resource tooling assessment](curriculum-resources.md#rendered-test-tooling-assessment).

Docker inspection confirmed exact container
`431daf93e644041f93af9aadf6e18fc74ecfc05a877cf8267ee753debad24bef`
(`lessonforge-drafts-20261019-zttunbka`) used tmpfs at
`/var/lib/postgresql/data`, no mounted volumes and loopback port 5434. Tests
disconnected, that exact container was stopped, `--rm` removed it, and an ID-filtered
listing returned no container. Existing Docker data was untouched.
After the final source comparison, the task-created verification copy and its
generated build artifacts were removed; the linked source dependencies remain.

## Separate live PostgreSQL suite

`npm run test:lessons:db --prefix backend` is opt-in and excluded from ordinary
unit/HTTP tests and CI. Run it only against a fresh empty disposable target; a
second run must use a newly created disposable container, not reset an old schema.
The following developer-run commands create task-only tmpfs PostgreSQL on loopback
5434. They do not use Compose or existing Docker volumes. Ensure that port is free.

```bash
docker run --detach --rm --name lessonforge-drafts-check --tmpfs /var/lib/postgresql/data:rw --publish 127.0.0.1:5434:5432 --env POSTGRES_USER=lessonforge_constraints --env POSTGRES_PASSWORD=disposable-lesson-fixture --env POSTGRES_DB=lessonforge_constraints_test postgres:17.11-bookworm
docker exec lessonforge-drafts-check pg_isready -U lessonforge_constraints -d lessonforge_constraints_test
CONSTRAINT_TEST_DATABASE_URL=postgresql://lessonforge_constraints:disposable-lesson-fixture@127.0.0.1:5434/lessonforge_constraints_test LESSONFORGE_CONSTRAINT_TEST=disposable npm run test:lessons:db --prefix backend
docker stop lessonforge-drafts-check
```

The first command creates disposable RAM-backed data with public fixture-only
credentials. Repeat readiness until accepting connections, then run the suite.
The URL must match the dedicated user, database, loopback host and port, have no
query parameters and carry the explicit `disposable` acknowledgement; the suite
also checks live identity and an empty public schema before deploying migrations.
It never reads `.env` or falls back to `DATABASE_URL`. The final command disposes
only the named task container and its tmpfs data, including after a failed test;
`--rm` removes the stopped container. Keep the name/ID returned by your own run.

## Changed files

- Backend: `backend/src/lessons/lessons.{controller,input,module,service,spec}.ts`;
  `backend/src/app.module.ts`; shared safe conflict wording, lesson parser and rate
  metadata/budget in `backend/src/auth/auth.{filter,guards,http,rate-limit}.ts`.
- Verification: `backend/test/lessons.e2e-spec.ts`,
  `backend/test/lessons.lessons-db-spec.ts`, `backend/test/support/lesson-fixture.ts`,
  `backend/vitest.config.lessons-db.ts`; `backend/package.json` adds only the live
  command, with no dependency or lockfile change.
- Frontend: `frontend/src/lib/lessons-{api,state}.ts`,
  `frontend/src/components/lessons-panel.tsx`, `frontend/src/app/page.tsx`,
  `frontend/test/lessons-{api,state}.test.mjs`.
- Documentation: this guide, README, architecture, specification, domain schema,
  roadmap, setup, CI and resource browser evidence.
