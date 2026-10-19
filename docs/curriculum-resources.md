# LessonForge curriculum resources

## Scope and implementation choices

NestJS owns resource authorization, validation, visibility, and concurrency.
Next.js provides authenticated browsing/detail and administrator management in the
home page. Resources use the existing `CurriculumResource` model; this feature
adds no migration, seed command, upload, AI, lesson selection, hard deletion, or
reactivation. Submitted snapshots, reviews, lessons, and copy provenance are never
written by resource endpoints. The manual-first administrator approval rules are
unchanged.

Retired resources are read-only. Repeating retirement with the current version
returns the unchanged record, including version and timestamps. A stale version
always conflicts, including after retirement. These choices implement retirement
without adding a restoration or retired-content correction workflow. There is no
blocking product decision for this scope.

## Endpoint contracts

All routes require an opaque cookie session. Teacher/administrator roles come
from NestJS authentication, never request fields. Responses use `Cache-Control:
no-store`. Unsafe requests require an exact configured Origin, JSON, and
`X-LessonForge-CSRF: 1`; existing authentication cookies, CORS and login limits
remain unchanged. Resource requests share a separate 120-per-IP-per-minute budget
across these endpoints, including failed authentication/role checks; limit responses
are 429 with `Retry-After`. Storage remains bounded and process-local; deployment
still requires the [staging prerequisites](roadmap.md#4-first-restricted-staging-deployment).

| Method and path | Access | Request | Success |
|---|---|---|---|
| `GET /resources` | Teacher, administrator | Optional `limit` (default 20, integer 1–50) and `after` (UUID) | 200 `{ items: ResourceSummary[], nextAfter: string \| null }` |
| `GET /resources/:id` | Teacher, administrator | UUID path parameter | 200 `Resource` |
| `POST /resources` | Administrator | Exact `ResourceContent` object | 201 `Resource`, version 1, active |
| `PUT /resources/:id` | Administrator | All `ResourceContent` fields plus `expectedVersion` | 200 committed `Resource` |
| `POST /resources/:id/retire` | Administrator | Exact `{ expectedVersion: number }` | 200 committed or already-retired `Resource` |

`ResourceContent` has exactly `title`, `subject`, `grade`, `sourceReference`, and
`contentText`. `ResourceSummary` has exactly `id`, `title`, `subject`, `grade`,
`retiredAt`, `version`, `createdAt`, and `updatedAt`. `Resource` adds
`sourceReference` and `contentText` to that summary. Timestamps are UTC ISO strings;
`retiredAt` is null while active. IDs and timestamps are server-assigned. Clients
cannot assign version, retirement state, or metadata through content updates.

Teachers list/view active records only. Retired and missing details both return
404 to teachers. Administrators list/view all records, with retirement state shown.
Lists omit large citation/content fields, sort by UUID ascending, and fetch at
most `limit + 1` rows to determine the next cursor. Follow `nextAfter` as `after`;
a null cursor means no next page. This is keyset pagination, not a stable historical
snapshot: records created behind an existing cursor appear on a fresh list load.
A cursor need not still be visible or exist. Duplicate/unknown query fields,
invalid limits, and malformed UUIDs are rejected rather than silently ignored.

### Validation and practical limits

| Field | Rule |
|---|---|
| `title` | Required nonblank string, at most 200 UTF-16 code units |
| `subject` | Exactly `Mathematics` |
| `grade` | Exactly `Grade 4` |
| `sourceReference` | Required nonblank citation text, at most 1,000 UTF-16 code units |
| `contentText` | Required nonblank plain text, at most 20,000 UTF-16 code units |
| `expectedVersion` | Required for edit/retirement; JSON integer from 1 through 2,147,483,647 |

Text bounds apply before trimming; outer whitespace is trimmed and interior text
is retained. NUL characters are rejected. UTF-16 units match JavaScript string
length and HTML `maxLength`; some symbols take two units. Resource JSON bodies are
bounded at 128 KiB to accommodate escaped text; other routes retain their existing
4 KiB body budget. Unknown fields, missing fields, arrays, nulls, invalid types,
and invalid context return 400. Oversized bodies return 413; non-JSON writes 415.
The browser's required fields/limits help usability; NestJS validates every request.

`sourceReference` is citation text even when it contains a URL. The application
neither fetches it nor treats it as a navigation destination. All resource text is
rendered through React text nodes with preserved line breaks; no raw HTML is used.

### Concurrency, failures, and reconciliation

Edits/retirement require the version the administrator actually viewed. NestJS
locks the resource row in a short PostgreSQL transaction, checks the version/state,
then updates the resource and increments its version atomically. A successful
content replacement increments the version even when the text is identical.
A missing resource returns 404. Stale versions, edits to retired records, and
counter exhaustion return 409 with a safe generic message; no current content is
included. Repeated current-version retirement does not increment the counter.
There are no automatic transaction retries against newer content.

Authentication failures return 401; unauthorized mutations return 403 before
resource lookup or version handling. Validation errors use a safe generic 400
message. Unexpected database/infrastructure errors return sanitized 503 with
`Retry-After`, never driver text, connection strings, or lesson data.

Frontend requests reuse the authentication transport's validated fixed origin,
credential inclusion, no-store/redirect policy, abort/cancellation handling, and
15-second deadline through complete JSON-body consumption. Success status and
response shapes are validated. Each authenticated workspace has isolated resource
state; identity/session changes dispose it, abort requests, and invalidate late
successes/failures. Pending writes cannot overlap reads or writes in that workspace.
A resource 401 asks the authentication provider to reconcile the session. Pending
authentication checks and unconfirmed logout disable resource controls while
retaining entered text for the last confirmed identity. Confirmed sign-out or a
changed authenticated identity/session clears that workspace.

Validation/conflict/availability failures retain entered text and its original
version. **Load latest result (keep entered text)** reads the current record for an
edit/retirement, or reloads the list for a create. It does not replace entered text
or silently change the save precondition. After comparing content, explicitly use
the displayed latest version before saving an edit again. A retired record cannot
be edited; the entered text remains available until explicitly discarded.

Network/timeout/cancellation, unexpected responses, and HTTP 500/502/503/504 on
mutations are uncertain: the server may already have committed. The state records
the operation type (`create`, `edit`, or `retire`) and the exact target UUID for an
edit/retirement; a create has no known target. The UI blocks further writes/discard
until a successful reconciliation read and explicit acknowledgement. Validation
and other confirmed rejections (including 400/403), authentication failures (401),
and version/state conflicts (409) keep their distinct error handling and do not
become uncertain infrastructure failures. Entered content and the original edit
version are retained. The shared transport also classifies these server failures
as availability errors for authentication POSTs; 401 handling is unchanged. GET
classification is unchanged (503 unavailable; 500/502/504 rejected).

Only an uncertain create can reconcile through a successful list load. Inspect
list pages and details for the new resource before acknowledging; an empty page
does not prove that creation failed. There is no idempotency key or automatic
duplicate detection, so deliberate resubmission after acknowledgement can still
create a duplicate. An uncertain edit/retirement requires **Load latest result** to
successfully read the exact recorded target's detail. Lists, unrelated/empty pages,
failed detail requests, and mismatched detail responses cannot enable acknowledgement.
Starting a new reconciliation clears the previous acknowledgement eligibility;
a failed attempt leaves it disabled. Neither reconciliation nor acknowledgement
changes retained edits or the original version precondition. Reads and failures
never automatically retry writes. Entered text is in memory only; page reload,
signing out, or changing identity clears it. Frontend role controls are presentation;
NestJS remains authoritative.

## Original sample for manual entry

This is original LessonForge demonstration material for a fictional school. It
makes no official curriculum-alignment claim. Enter it manually as an administrator;
no seeding or development-database change is performed by the implementation task.

- Title: `Equal parts with paper strips`
- Subject: `Mathematics` (fixed)
- Grade: `Grade 4` (fixed)
- Source reference: `Original LessonForge fractions demonstration material. No official curriculum alignment claimed.`
- Resource text:

```text
Cut or draw two paper strips of the same length. Fold the first into two equal
parts and shade one part. Label the shaded part one half (1/2).

Fold the second strip into four equal parts and shade two parts. Label the shaded
parts two quarters (2/4). Place the strips beside each other and compare the
shaded lengths. Explain why the same amount is shaded.

Ask learners to draw a third strip divided into four equal parts and shade one
quarter (1/4). Which is larger: one quarter or one half? Ask learners to explain
using the equal-sized strips rather than the denominator alone.
```

## Local startup and manual browser verification

Use the existing configured/migrated local database and already-provisioned accounts
privately. These are developer-run steps; do not share credentials, cookie values,
request bodies containing secrets, or unredacted Network exports. No new package
or migration is required. From the repository root:

```bash
nvm use
docker compose up -d --wait db
```

This selects the project Node version and starts the existing local PostgreSQL
service without resetting its volume or applying migrations. In separate terminals:

```bash
NODE_ENV=development PORT=3001 API_PUBLIC_ORIGIN=http://localhost:3001 AUTH_ALLOWED_ORIGINS=http://localhost:3000 AUTH_COOKIE_MODE=local-http npm run start:dev --prefix backend
```

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm run dev --prefix frontend -- --hostname localhost --port 3000
```

Backend startup generates Prisma and checks connectivity; it does not migrate or
seed. Existing ignored configuration supplies database credentials privately.
Next.js embeds the public API origin. Open exactly `http://localhost:3000` and
use `localhost` for both applications. Stop each with Ctrl+C. See
[development setup](development-setup.md) for the established local configuration.

The developer reported completion of this resource browser checklist on
**2026-10-19**. See the [report and its limits](#developer-browser-report-2026-10-19).
The checklist is retained for reproducibility:

1. Without a session, confirm resources are hidden and direct API reads return 401.
   Sign in as administrator; load the resource list and create the sample above.
   Confirm success, active status, version 1, then Reload list and open its detail.
2. Confirm title, citation, and multiline text match. Try `<b>plain text</b>` in a
   test resource: it must display literal markup. A citation URL must remain text
   and cause no outbound request to that URL.
3. Edit the sample and save; confirm its version increments and refresh/detail
   shows persisted changes. Empty/blank/oversized fields, unknown properties, and
   wrong subject/grade must fail through direct API requests, even bypassing the UI.
4. In two administrator tabs open the same version. Save a change in one, then save
   different text in the other. Expect 409 with entered text retained. Load latest,
   compare both texts, explicitly adopt the displayed version, then choose whether
   to save again. Verify the winning content was not silently overwritten.
5. Cancel retirement once, then confirm it. Verify retired status and incremented
   version, no edit/retire controls, continued administrator detail visibility, and
   unchanged historical lesson snapshots if fixture history is available. Direct
   stale retirement must conflict; current-version repeated retirement must return
   the same timestamps/version. Retired content updates must conflict.
6. Sign out and sign in as teacher. Confirm only active resources appear, active
   details are readable, and management controls are absent. A known retired UUID
   must return 404; create/edit/retire attempts must return 403. Confirm list pages
   use Next page and Reload list without exposing retired resources.
7. Exercise local API request blocking during reads and saves. Errors must leave
   entered edits intact. For uncertain writes, unblock, Load latest result, compare
   the saved state/list (all pages as needed), and acknowledge explicitly. Verify
   no write is automatically replayed and no duplicate create occurs without a
   deliberate new submission. Separately exercise slow headers/bodies and
   500/502/503/504 mutation responses, including a committed write whose successful
   response is replaced by a gateway failure, using controlled response overrides
   where available. For uncertain retirement, Reload list/Next page must not enable
   acknowledgement; only a successful Load latest result for that exact resource
   can. Failed detail requests must leave acknowledgement disabled, including after
   an earlier successful reconciliation. Do not infer these checks from a simple
   outage test.
8. With a read or write pending, sign out and switch teacher/admin accounts. Confirm
   the new account never receives the old account's list, detail, entered text,
   pending state, or late error. Also block logout while editing: an unconfirmed
   logout must retain entered text with resource controls paused until session
   reconciliation; only confirmed logout clears it. A write already accepted by the API may complete
   for the original authorized actor; reconcile from the appropriate account.
9. Use keyboard-only navigation, visible focus, Enter submission, labeled fields,
   status/error announcements, and retirement confirmation/cancel controls. Check
   narrow screens and browser zoom. Screen-reader/rendered-component checks remain
   separate from request/state tests.
10. Inspect no-store responses and credentialed CORS. Reject resource writes with
    missing CSRF header, wrong Origin, or wrong content type. Recheck login/refresh/
    logout and the [authentication browser checklist](frontend-authentication-verification.md#manual-browser-checklist).
    Local HTTP does not establish deployed HTTPS/cookie or staging readiness.

## Automated verification

Ordinary checks remain database-free, using installed tooling:

```bash
npm test --prefix frontend
npm run lint --prefix frontend
npm run typecheck --prefix frontend
npm run build --prefix frontend
npm run build --prefix backend
npm run lint --prefix backend
cd backend
./node_modules/.bin/tsc --noEmit
npm test
npm run test:e2e
```

Build/typegen commands write generated build files. Normal builds load application
configuration, so agent checks use an isolated source copy excluding real `.env*`
files, dependencies/build output before reusing the installed dependencies. No
packages are installed. Ordinary frontend tests mock fetch; backend unit/HTTP
tests mock database access and authentication principals. HTTP tests still run
real guards, CSRF/body middleware, response filtering, and resource services.

### Separate live PostgreSQL suite

`npm run test:resources:db --prefix backend` is deliberately excluded from ordinary
unit/HTTP checks and CI. It reuses the existing strict URL, database/role identity,
and empty-public-schema guards. It never loads `.env`, falls back to `DATABASE_URL`,
or resets/drops/truncates data. Refuse a populated target; each invocation requires
a fresh disposable container. From the repository root, after confirming localhost
port 5434 is free, create only this task's container:

```bash
docker run --rm -d --pull=never --name lessonforge-resources-test -p 127.0.0.1:5434:5432 --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=lessonforge_constraints -e POSTGRES_PASSWORD=resource_fixture_only -e POSTGRES_DB=lessonforge_constraints_test postgres:17.11-bookworm
docker exec lessonforge-resources-test pg_isready -U lessonforge_constraints -d lessonforge_constraints_test
```

This uses the already-installed pinned image, loopback port, fixture-only password,
and temporary storage. If the port/name/image is unavailable, resolve that without
stopping existing containers or pulling/installing anything implicitly. Wait until
`pg_isready` reports accepting connections, then run:

```bash
CONSTRAINT_TEST_DATABASE_URL='postgresql://lessonforge_constraints:resource_fixture_only@127.0.0.1:5434/lessonforge_constraints_test' LESSONFORGE_CONSTRAINT_TEST=disposable npm run test:resources:db --prefix backend
```

The suite applies the tracked migrations through `prisma.constraints.config.ts`
only after its guards pass. It creates disposable resources and nonempty approved
history/copy fixtures; independent clients exercise persistence, edit/edit,
edit/retirement and retirement/retirement races, retained timestamps/versions,
transaction rollback after actual writes, pagination, and unchanged domain
history/snapshots. It uses a fixture superuser and does not prove least-privilege
staging roles or deployed session behavior. Disconnects run even after failure.

After inspecting the ID/name to confirm it is exactly the container created above:

```bash
docker inspect --format '{{.Id}} {{.Name}} {{json .HostConfig.Tmpfs}}' lessonforge-resources-test
docker stop lessonforge-resources-test
```

`--rm` removes that container and its temporary data after stopping. Never substitute
an existing development container/volume. The agent's actual results and limitations
are recorded below; commands alone are not passing evidence.

### Implementation-task evidence

Checks used installed Node 24.21.0 and dependencies. Backend/frontend commands ran
in `/tmp/lessonforge-resources-8c8qy0uz`, excluding real environment files and old
build output. Backend reused installed dependencies through a symlink; the frontend
build used a copy of the existing installed packages. No package installation,
development-database connection, seed, migration change, commit, or push occurred.
Changed application/test/config files matched the verification copy after checks.
A final frontend-only availability correction retained entered edits during
unconfirmed logout/session checks. Its follow-up used the same installed packages
in `/tmp/lessonforge-resources-final-v95xox65`, again without real environment files.
Two commands started before the dependency copy was ready and stopped at missing
binaries; they were rerun after copying completed. This setup failure is not a
passing check. Final frontend lint, route typegen/TypeScript, all 46 request/state
tests, and the Webpack production build passed again after that correction; the
changed frontend files matched the follow-up copy.

| Check | Actual result |
|---|---|
| Backend unit tests | 177 passed across 12 files, including 6 resource cases |
| Backend HTTP tests | 60 passed across 4 files, including 8 resource cases, after expanded local socket permission |
| Backend TypeScript, lint, Prisma generation, build | Passed |
| Frontend request/state tests | 46 passed, including all 33 existing authentication cases and 13 resource cases |
| Frontend lint and route typegen/TypeScript | Passed |
| Default frontend Turbopack build | Blocked: sandbox font downloads failed; permitted retry reached internal PostCSS port-bind `EPERM` |
| Frontend Webpack production build | Passed with expanded permissions: compilation, TypeScript, static prerendering, and build tracing exited 0 |
| Guarded live resource suite | 6 passed on fresh PostgreSQL 17.11 with independent clients |
| Changed-source formatting, whitespace, local references | Passed; referenced files and heading anchors exist |

The first live attempt failed its identity query under sandbox networking; it
stopped before migration/fixture writes. The permitted retry passed the same
URL/identity/empty-schema guards, applied tracked migrations, and passed all six
tests. The HTTP suite initially failed local port binding under the sandbox; only
the permitted passing run counts as successful verification. The default frontend
build remains unchanged; the passing Webpack fallback is separate evidence.

Docker inspection confirmed task-created container
`c6b80e02a1eee2872ec64213ebf5ecc2c4298f0cf4ca6ba721350fde81c7884c`
(`lessonforge-resources-20261016-1258`) used tmpfs at
`/var/lib/postgresql/data` and no existing volumes. After tests disconnected, that
exact container was stopped; `--rm` removed it, and an ID-filtered listing confirmed
absence. Existing Docker data was untouched. The isolated verification copy and
task-created temporary records/build artifacts were removed after verification.

These checks do not establish rendered browser interaction, keyboard/screen-reader
behavior, a new GitHub Actions run, a clean dependency installation, successful
default Turbopack build, least-privilege database roles, deployed HTTPS/cookies,
or staging readiness. Complete the manual checklist above and retain the existing
[authentication verification gaps](frontend-authentication-verification.md#remaining-evidence).

### Review-fix verification

The read-only review found that 500/502/504 mutation responses could permit an
immediate repeat submission, and list loads could incorrectly reconcile uncertain
retirement. The frontend fixes now record operation type/target and enforce the
reconciliation rules above. Backend endpoints, schema, migrations, and domain
history behavior did not change; the earlier backend/live evidence is retained,
not reported as rerun for these frontend fixes.

Checks reused installed Node 24.21.0 and packages in
`/tmp/lessonforge-resource-review-fixes-zg0vh40g/frontend`. The source copy excluded
real `.env*` files and old build output; installed dependencies were copied without
installing packages. All seven changed frontend implementation/test files matched
the verification copy. Fetch was mocked and no database or backend was started.

| Follow-up check | Actual result |
|---|---|
| `npm test` | 65 passed: 49 top-level tests and 16 status/operation subtests |
| `npm run lint` | Passed |
| `npm run typecheck` | Next.js route type generation and TypeScript passed |
| `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm run build -- --webpack` | Passed with expanded permissions: compilation, TypeScript, static pages, optimization, and build tracing exited 0 |
| Changed frontend formatting | Prettier check passed |
| Whitespace and local resource-guide references | Passed, including the new untracked test file |

The sandboxed Webpack build stopped with `Could not parse output from TypeScript's
--showConfig`; the permitted retry passed. The default Turbopack build was not rerun;
its previously recorded environment restriction remains separate from this Webpack
result. This follow-up does not add GitHub CI, rendered/browser, live proxy/database,
or deployed-session evidence.

After verification and the final source comparison, the task-created temporary
copy and its generated build artifacts were removed. No packages were installed,
real environment files read, database accessed, commit created, or push performed.

The new `resources-reconciliation.test.mjs` connects the real resource API helper,
credentialed transport/response validation, and state store to an in-memory fetch
fixture. Its three top-level tests include 16 create/edit/retirement scenarios for
500/502/503/504: creates that did or did not commit before the failure; no immediate
duplicate POST; required acknowledgement after a successful read; unrelated/empty
list pages; failed and wrong-target detail responses; invalidated eligibility when
a new reconciliation fails; retained edits/base versions; explicit version adoption;
and distinct validation/authentication/authorization/conflict handling. The fixture
records simulated persistence before gateway failure; it is not a new live database
or real proxy test. Existing resource status tests cover the error reasons, and
the authentication API test now expects server failures on POSTs to be availability
errors while retaining GET/401 behavior. The initial full run exposed the old POST
500 expectation; the final full run passed after updating that expectation.

### Developer browser report 2026-10-19

The developer reported the resource teacher/administrator browser checklist above
complete on 2026-10-19. This is developer-reported manual browser evidence, not an
agent rerun or a new automated result. No additional browser traces or item-level
measurements were supplied for this task. Earlier statements that the manual
resource checklist was pending describe the earlier verification sessions.

This report does not close previously pending **automated rendered-component**
coverage, **deployed HTTPS/cookie** verification, or staging prerequisites. The
tooling assessment below and the separate authentication gaps remain applicable.
The new [teacher draft browser checklist](teacher-drafts.md#local-checks-and-browser-checklist)
remains pending; resource browser completion does not establish lesson editor behavior.

### Rendered-test tooling assessment

Rendered coverage for identity changes during pending mutations, unconfirmed
logout, and paused resource controls remains **pending**. Installed tooling was
checked in both applications: React/React DOM and Node's test runner are available,
but Playwright, Puppeteer, React Testing Library, JSDOM, Happy DOM, and React Test
Renderer are not installed. The optional Playwright peer entry in Next.js's lockfile
is not an installed browser runner. React DOM's test utilities alone supply no DOM
or browser, and server rendering cannot exercise effects, identity-key cleanup,
pending mutations, or disabled-control interactions. No packages were installed.

For future browser tests, the developer can add Playwright from the repository root:

```bash
npm install --save-dev --prefix frontend @playwright/test
cd frontend
npx --no-install playwright install chromium
```

The first command changes the frontend manifest/lockfile and installs test tooling;
the second installation downloads Chromium for browser tests. These are proposed
developer-run setup commands, not completed verification. After installation,
add a database-free browser fixture with mocked `/auth/*` and `/resources*` routes
and deferred responses. Verify that late mutation successes and failures after
confirmed logout/account switching cannot update the next workspace; failed logout
retains entered content; and pending/unconfirmed authentication disables all resource
controls until session reconciliation. Exercise actual fieldset behavior, keyboard
interaction, and the React effect cleanup rather than substituting manual store
disposal. Existing request/state tests do not establish those rendered guarantees.

## Changed files

- Backend resource implementation: `backend/src/resources/resources.controller.ts`,
  `resources.input.ts`, `resources.module.ts`, `resources.service.ts`, and
  `resources.spec.ts` in that directory; module registration in
  `backend/src/app.module.ts`.
- Shared backend HTTP behavior: `backend/src/auth/auth.filter.ts`, `auth.guards.ts`,
  `auth.http.ts`, and `auth.rate-limit.ts` in that directory.
- Backend verification/tooling: `backend/test/resources.e2e-spec.ts`,
  `backend/test/resources.resources-db-spec.ts`, `backend/vitest.config.resources-db.ts`,
  and `backend/package.json` (live-test script only; no dependency change).
- Frontend implementation: `frontend/src/lib/api-request.ts`, `auth-api.ts`,
  `resources-api.ts`, and `resources-state.ts` in that directory;
  `frontend/src/components/resources-panel.tsx` and `frontend/src/app/page.tsx`.
- Frontend verification: `frontend/test/resources-api.test.mjs` and
  `frontend/test/resources-state.test.mjs`, plus the review-fix transport-to-state
  cases in `frontend/test/resources-reconciliation.test.mjs` and shared-transport
  status expectations in `frontend/test/auth-api.test.mjs`. CI's frontend test step label in
  `.github/workflows/ci.yml` now describes request/state tests; required job names
  and database-free commands are unchanged.
- Documentation: this guide, `README.md`, `docs/architecture.md`, `docs/ci.md`,
  `docs/development-setup.md`, `docs/domain-schema.md`, `docs/project-specification.md`,
  and `docs/roadmap.md`.
