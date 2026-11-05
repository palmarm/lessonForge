# Approved library frontend handoff

Backend authority: [approved-library contracts](../approved-library.md). This is an
integration guide for the Approved Library frontend. The API guide remains the backend authority.
Keep permission, eligibility, snapshot and idempotency rules in NestJS.

## Latest developer-performed manual verification

The developer confirmed: **all eight performed checks passed**, preserving Pending
HTTPS and other untested items. These are developer-performed manual results,
not Codex-executed tests or a successful automated browser rerun.

| Reported manual evidence | Confirmed outcome |
|---|---|
| Eight developer-performed checks, as a group | All eight passed — developer confirmation. |
| Keyboard checks | Passed as manual evidence within the reported checks; no automated keyboard pass claimed. |
| Narrow-screen checks | Passed as manual evidence within the reported checks; no automated responsive-rendering pass claimed. |

Keyboard and narrow-screen entries describe coverage within the eight checks,
not additional checks. Individual descriptions and a numbered outcome breakdown
were not supplied; no extra scenarios, viewport sizes, browser versions, HTTP
statuses, operation keys, destination identities or database observations are
inferred. The report is retained at its confirmed level of detail.

Earlier statements that manual keyboard/narrow-screen checks were unverified
are historical checkpoints preceding this confirmation. Automated rendered
verification remains blocked: the independent rerun reached no interactions
because startup failed with `listen EPERM` on `127.0.0.1:3210`, despite
`libnspr4.so` resolving. That blocked result and all earlier automated evidence
remain unchanged below. Manual success does not establish an automated rerun.

HTTPS remains **Pending**, as do other untested items, including any individually
tracked integrated API/database result not identified in the developer's report.
The aggregate eight-check confirmation is not expanded into check-specific
claims for the four live rows below.

| Action | Backend contract | Required client handling |
|---|---|---|
| Browse | TEACHER/ADMIN `GET /library/approved?limit=20&after=...` | UUID-ordered cursor pages, not chronological approval order. No search/filter API is implied. |
| Read | `GET /library/approved/:lessonId/revisions/:revisionId` | Render exact approved content, generation origin and retained citations/snapshots as text. Do not load another teacher's history or mutable draft. |
| Intentional copy | TEACHER `POST /lessons/:lessonId/revisions/:revisionId/copy` with `{ operationKey, expectedVersion }` | Generate one lowercase UUIDv4 per intentional action. Retain key, source IDs and source workflow version before sending. Administrator has browse controls only. |
| Created/replayed | 201 first creation; 200 matching replay; both `{ operation }` | Validate receipt matches key and original normalized source/preconditions. Record its destinationLessonId. Receipt contains no draft/state and never promises current editability. |
| Recover uncertain result | TEACHER `GET /library/copy-operations/:operationKey` | Exact actor-scoped receipt. No candidate list or title/content matching. A 404 can precede an in-flight commit. |
| Retry same operation | Repeat original copy POST with same key/parameters | Safe against duplicate destinations, including after timeout/abort/invalid success or 503. Never replace key or update expectedVersion during automatic recovery. A new key is another intentional copy. |
| Open destination | Owned `GET /lessons/:id/revisions`, then draft or revision detail | History gives current workflow, including empty history for a new draft. Load editable detail for DRAFT/CHANGES_REQUESTED; submitted/approved content through history/detail. Reconcile state races. |
| Key mismatch/stale source | Sanitized 409 | Preserve operation identity; inspect/recover deliberately. Do not silently rebase the operation onto another source revision/version. |

The receipt is exactly:

```text
{ operation: {
    key,
    source: { lessonId, revisionId, expectedVersion },
    destinationLessonId
} }
```

Generate keys with `crypto.randomUUID()`. Canonical lowercase version 4 and an RFC
variant nibble 8/9/a/b are required. Owner IDs and current draft content are absent
from the receipt. Shared library responses also omit author identities, reviewer
identities and review feedback; existing owner/admin history permissions remain.

Retain an uncertain operation across supported recovery paths **before** issuing
its POST. Losing the key loses exact operation lookup; do not compensate by
automatically generating another copy. This handoff does not add browser storage;
the frontend implementation must explicitly choose how long recovery survives
reload/navigation and make that limitation clear. Account changes must isolate
pending keys/results with the existing authenticated workspace handling. Pause on
unconfirmed authentication and ignore stale responses after identity changes.
Every replay/recovery requires fresh valid authentication and teacher authorization.

Do not replace local unsaved destination edits with source content after recovery.
A copy can already be edited, submitted or approved when recovered. Fetch current
authorized state, explicitly reconcile conflicts and retain the original provenance.
Copying preserves AI_ASSISTED origin where present but never transfers approval.
Older/retired source snapshots remain readable/submittable and are not refreshed.

## Frontend implementation — 2026-11-05

Implemented on the existing `feat/frontend-approved-library` branch, verified clean
before edits. No branch switch, staging, commit, push, dependency installation,
backend contract/schema change or development database migration was performed.

- Both roles have Library navigation. `/library` loads bounded cursor pages and
  exact approved revision detail using library routes only. There is no search,
  filter or date sorting. Source owner history and mutable drafts are never read.
  The shared revision renderer displays content, origin, citations and retained
  resource text without executing markup or linking citation URLs.
- Teachers explicitly choose **Copy to my drafts**. Each intentional copy uses one
  lowercase `crypto.randomUUID()`. The key, normalized source lesson/revision IDs
  and original workflow version are retained synchronously before POST. One
  unresolved copy prevents another intentional copy; successful operations remain
  available for destination inspection and a later intentional copy gets a new key.
- Operations live only in the authenticated shell, keyed by user, role and session
  expiry, and survive route navigation. No browser storage was added. A persistent
  unresolved-copy message explains that reload, tab close and confirmed session end
  lose the key. Unload warns; explicit sign out warns about losing exact recovery.
  Copy uncertainty does not block ordinary workspace navigation. Unconfirmed
  authentication pauses requests and invalidates in-flight responses; identity or
  session replacement disposes old operations and ignores their late results.
- Both 201 creation and 200 replay must contain an exact receipt matching the
  retained key, source IDs and expectedVersion. Invalid success, transport failure,
  timeout, 503 and 409 preserve the operation. **Check copy status** performs the
  actor-scoped GET; 404 remains unresolved and can be followed by a receipt.
  **Retry same copy** resends only the original key and parameters. There is no
  automatic retry, new key, source-version adoption or 409 rebase.
- A receipt proves destination identity only. **Read current destination** reads
  owner history first (including empty new-draft history), then editable detail for
  DRAFT/CHANGES_REQUESTED or current exact revision detail for SUBMITTED/APPROVED,
  and reads history again. A version/state/revision mismatch requires another
  explicit inspection; no editor version is adopted. Reads that fail also leave
  the receipt and inspection control available. Normal backend version checks
  still protect against changes after inspection.
- Opening a destination uses the existing teacher editor store. An open editor is
  never replaced: an editor for that destination keeps all local content and its
  baseline; another open draft must be saved/explicitly closed first. Pending,
  uncertain or workflow-locked editors cannot be replaced. Recovery does not copy
  source content into an existing destination, transfer approval, or refresh
  source snapshots. NestJS still decides access and eligibility.

## Prior implementation verification evidence

Mocked frontend evidence, backend tests and live acceptance are separate below.
An intercepted Chromium response is not evidence of a real API/database copy.

| Category | Check | Observed result |
|---|---|---|
| Frontend request/state | Full Node request/state suite | 152 passed, 0 failed |
| Frontend static | ESLint | Passed |
| Frontend static | `npm run typecheck` (route generation and TypeScript) | Passed |
| Frontend build | Environment-free verification copy, Webpack | Passed on final source, including compilation, TypeScript, page generation and tracing |
| Mocked rendered Chromium | 14 focused library cases, single worker | Blocked at setup; 0 interaction cases executed. Installed Chromium cannot load `libnspr4.so`. |
| Backend unit (database mocked) | Existing library service/input tests, one worker | 15 passed, 0 failed |
| Backend HTTP (service mocked) | Existing library HTTP contract tests, one worker | 6 passed, 0 failed after permitted socket retry |
| Live API/database | Integrated frontend acceptance | Pending; see individual checks below |
| HTTPS | Deployed browser/cookie/CORS/CSRF acceptance | Pending; no HTTPS target exercised |

The first focused request/state run passed 13 and failed two test-fixture assertions:
an uppercase-key check used digits only, and a refreshed-detail fixture read the
store after detail was intentionally cleared. Both fixtures were corrected; the
full 152-test result above includes the corrected cases. A repeated attempt before
those fixes applied encountered an incorrect working directory and reproduced the
same two failures. No application validation was weakened for these assertions.

Memory was checked before verification (about 1.3–2.0 GiB available). Checks run
sequentially. Port inspection initially failed under sandbox netlink restrictions;
the permitted read showed no frontend/API/test listener on 3000/3001/3210 and an
existing PostgreSQL listener on 5433. It was not accessed or changed. Verification
uses installed dependencies and a source copy without `.env*`, existing `.next`
output or Git metadata at `/tmp/lessonforge-approved-library-x8ofpdwj/frontend`.
The sandbox Webpack attempt failed with Next.js's existing `--showConfig` parsing
restriction; its permitted retry compiled, type-checked and generated `/library`.
Final refinements clear stale pause text on session confirmation, invalidate prior
destination inspection during auth uncertainty, and explain reinspection after
any destination read failure. A dedicated state regression covers these paths.
The final lint, standard typecheck and production build all passed after those
refinements. SHA-256 comparison matched all 60 frontend source, test, configuration
and README files to the verification copy. `git diff --check` and 19 relative
documentation path checks passed. Final listener inspection confirmed no
3000/3001/3210 server remained. Backend files and package manifests/lockfiles are
unchanged; the index remains empty on `feat/frontend-approved-library`.

The mocked Chromium command used the installed Playwright module at
`/home/mariga/design-work/lessonforge-ui/node_modules/playwright/index.mjs`, the
installed default Chromium cache, `--test-concurrency=1` and the `^library` name
filter. The sandbox could not start its production test server. The permitted
retry started that server but Chromium exited with code 127 before any test
interaction because `libnspr4.so` is absent. All 14 library cases reported shared
setup failures, not observed product failures. No browser/OS dependency was
installed and no system settings were changed. The harness stops its own server
in teardown. Keyboard focus, narrow-screen rendering and visible recovery-message
assertions are implemented but **not verified in a browser in this run**. The
existing full rendered regression suite was not rerun after this setup blocker.
The rendered test module passes Node syntax checking.

Fresh backend commands were `npm test -- src/lessons/library.spec.ts
--reporter=dot --no-file-parallelism --maxWorkers=1` (15 passing unit cases) and
`npm run test:e2e -- test/library.e2e-spec.ts --reporter=dot
--no-file-parallelism --maxWorkers=1` (6 passing HTTP cases). The first HTTP attempt
failed all six cases on sandbox `listen EPERM`; the unchanged permitted retry
passed. Unit tests mock database access; HTTP tests mock library service behavior.
Neither result exercises PostgreSQL or establishes integrated frontend acceptance.
No fresh database, migration, full-backend-suite or HTTPS check is claimed.

Backend evidence in [the API guide](../approved-library.md#verification) is prior
backend evidence and is not a fresh frontend or integrated acceptance result.

## Independent frontend review — 2026-11-05

**Findings:** No actionable application defect identified in the complete feature
diff. This is a source/request-state review result, not live or rendered acceptance.
Branch and status were checked before review: `feat/frontend-approved-library`,
with HEAD, local `staging` and `origin/staging` all at
`41657a1bba88138d7c6ed149241adc7584f69f53`. The staging merge base is that same
commit. Review covered all 12 tracked modifications and eight untracked files;
there are no committed feature changes beyond the base. Existing work was retained.

Review used AGENTS.md and its referenced project documents, with
`docs/approved-library.md` as API authority and this handoff for frontend behavior.
It traced role-specific controls, UUID cursor validation, exact library-only source
reads, synchronous retention of original operation parameters, navigation/session
lifetime, authentication pauses and stale-response invalidation. Receipt handling
for 201/200/lookup, unresolved 404, original-parameter retry and non-rebasing 409
were inspected, together with current destination history/detail/history reads,
workflow race rejection, preservation of open editors and deliberate new-key copies.

### Fresh independent checks

Checks ran sequentially with installed dependencies and Node 24.21.0. No installation
or application/test-code change was made.

| Check | Actual result |
|---|---|
| `npm test -- --test-concurrency=1` in `frontend` | 152 passed, 0 failed; request/state evidence only. |
| `npm run lint` in `frontend` | Passed. |
| `npm run typecheck` in an environment-free review copy | Route generation and TypeScript passed. |
| `NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm run build -- --webpack` in that copy | Blocked: `Could not parse output from TypeScript's --showConfig.` No fresh build pass claimed. |
| Focused mocked rendered suite, `node --test --test-isolation=none --test-concurrency=1 --test-name-pattern='^library' test/rendered/foundation.test.mjs` | 14 shared-setup failures, 0 interaction cases executed; not observed application failures. |
| `node --check frontend/test/rendered/foundation.test.mjs`; `git diff --check` | Passed. |

The review copy was `/tmp/lessonforge-library-review-9g7xpaeo/frontend`, excluding
`.env*`, dependencies, existing `.next` output and TypeScript build caches; installed
dependencies were linked. Before the rendered retry, the existing user-local runtime
under `~/.cache/lessonforge-browser-runtime` was checked. With its
`root/usr/lib/x86_64-linux-gnu` on the command-local `LD_LIBRARY_PATH`, `ldd` on
its Chromium headless shell resolved `libnspr4.so` and reported no missing libraries.
This removes the earlier library-resolution blocker, but is not a browser launch pass.

Immediately before rendered execution, about 1.94 GiB memory was available and no
Next.js/test-browser server process was observed. Socket inspection itself was
restricted (`Cannot open netlink socket: Operation not permitted`). SHA-256 comparison
matched all 67 non-environment/non-output frontend files against the retained
`/tmp/lessonforge-approved-library-x8ofpdwj/frontend` copy, whose production build
was prior evidence. That matching artifact was used for the rendered attempt, not
represented as a freshly successful build. The command selected the installed
Playwright module documented above, the user-local `browsers` directory and the
command-local library path, with one worker and the harness's single server.

The harness reported `Production test server did not start`. After it exited, a
sequential, time-bounded direct startup diagnostic established the exact blocker:
`listen EPERM: operation not permitted 127.0.0.1:3210`. No expanded-permission retry
was attempted. Keyboard focus, narrow-screen rendering and rendered recovery,
navigation/session and unsaved-editor interactions therefore remain **unverified**.
The full rendered regression suite was not rerun. Earlier automated build/backend
results remain prior evidence, not fresh checks in this review. No backend, database,
migration, integrated live or HTTPS check was run. All four live rows below and
HTTPS remain individually **Pending**.

Only this existing handoff was edited for the review record. No branch switch,
staging, commit, push, backend-contract change or system-setting change was made.
Final status retained the same branch and existing work, with an empty index;
no Next.js/test-browser server process remained visible after teardown/diagnosis.

### Additional independent review pass — 2026-11-05

**Findings first:** No actionable application defect found. This additional pass
independently inspected the complete staging-base diff and all eight untracked
files, including tests. Branch, HEAD, staging refs and merge base were rechecked:
`feat/frontend-approved-library`, base `41657a1bba88138d7c6ed149241adc7584f69f53`,
12 tracked modifications, eight untracked files and an empty index. The review
covered the permission/privacy, pagination, retained-operation/session, receipt,
same-key recovery, destination-race and unsaved-editor paths listed above.

Fresh checks in this additional pass ran sequentially using installed dependencies
and Node 24.21.0; no application or test code was changed:

| Check | Fresh observed result |
|---|---|
| `npm test -- --test-concurrency=1` | 152 passed, 0 failed; mocked request/state evidence only. |
| `npm run lint` | Passed. |
| `npm run typecheck` | Route generation and TypeScript passed in `/tmp/lessonforge-review-current-zoszdl7f/frontend`, an environment-free copy with linked installed dependencies. |
| Environment-free Webpack production build | Blocked by `Could not parse output from TypeScript's --showConfig.` No fresh build pass. |
| Focused rendered library suite, one worker | 14 shared-setup failures; zero interaction cases executed. |
| Rendered test syntax; `git diff --check` | Passed. |

Before the rendered retry, `ldd` with the existing user-local runtime's
`root/usr/lib/x86_64-linux-gnu` on command-local `LD_LIBRARY_PATH` resolved
`libnspr4.so` and reported no missing libraries. Memory available was approximately
2.0 GiB; no Next.js/browser process was observed. Listener inspection was restricted
by `Cannot open netlink socket: Operation not permitted`. SHA-256 comparison matched
all 67 non-environment/non-output frontend files to the existing prior-build copy
at `/tmp/lessonforge-approved-library-x8ofpdwj/frontend`. Only that matching prior
artifact was used for the rendered attempt, with the documented installed
Playwright module, user-local browsers and one harness server; no build success
was inferred from it. The harness failed before browser launch. A subsequent,
time-bounded direct startup diagnostic confirmed the exact blocker:
`listen EPERM: operation not permitted 127.0.0.1:3210`.

All earlier build, backend and automated review results above remain prior evidence,
not fresh results of this pass. Keyboard, narrow-screen and rendered recovery,
session/navigation and unsaved-editor checks remain **unverified**. No live
API/database or HTTPS check ran: live browse/detail, copy, same-key recovery and
deliberate second copy remain individually **Pending**, as does HTTPS. No packages
were installed, system settings changed, backend contracts modified or Git
branch/staging/commit/push actions taken. Only this existing handoff was edited;
existing application/test work was preserved.

## Live acceptance — independently tracked

Keep each item Pending until its observed integrated frontend + NestJS + database
result is recorded. Mocked state/browser success cannot update these rows. The
latest developer confirmation above reports eight manual passes collectively,
without identifying which integrated API/database observations support each row;
these check-specific statuses therefore remain Pending.

| Live acceptance check | Status | Observed result |
|---|---|---|
| Browse the Approved Library and open an exact approved revision. | Pending | No check-specific integrated result supplied in the eight-check confirmation. |
| Copy an approved revision and verify the destination draft. | Pending | No check-specific integrated result supplied in the eight-check confirmation. |
| Recover an uncertain copy using the same key and verify that it resolves to the original destination without creating another draft. | Pending | No check-specific integrated result supplied in the eight-check confirmation. |
| Deliberately copy the same revision again using a new key and verify that it creates a distinct destination draft. | Pending | No check-specific integrated result supplied in the eight-check confirmation. |

Live acceptance requires a separately prepared API/database with the reviewed copy
migration applied, provisioned teacher/admin accounts and approved content. This
frontend task does not apply that migration or prepare shared data. No integrated
frontend/API/database server pair or HTTPS target was exercised by the agent in
the implementation/review runs above. This does not negate the later
developer-performed manual results.

## Short manual checklist for independent review

1. With teacher and administrator accounts, use keyboard navigation to Library,
   page forward and restart, then open an exact approved revision. Inspect every
   content section, origin, citation and retained snapshot; verify text markup is
   inert and administrators have no copy/recovery controls.
2. As a teacher, copy once. Record key, source IDs/version and receipt destination;
   inspect current workflow and open the authorized destination. Confirm origin,
   exact content/snapshots, independent draft status and no inherited approval in
   the database. Record the first two live results separately.
3. Discard one real POST response after commit. Navigate away/back, check status
   (including an early 404 if observed), then retry the same copy if necessary.
   Compare original key/body, receipt destination and database row count. Record
   the third live result only after proving there is one original destination.
4. Intentionally copy again and compare the new key, new destination and database
   count; record the fourth live result independently.
5. Inspect invalid receipts, 409, API outage, unconfirmed authentication and account
   or session changes. Verify visible messages, disabled controls, original
   parameters, and rejection of late responses. Test unload/sign-out warnings
   without losing an unresolved key unintentionally.
6. Recover a destination after edits, submission, requested changes or approval.
   Race the workflow between reads; explicitly inspect again. Keep unsaved editor
   text and its original baseline, including when a different draft is open.
7. Separately verify real HTTPS cookies, CORS/CSRF and assistive-technology behavior
   on the intended deployment. Mocked Chromium keyboard checks do not establish
   screen-reader or deployed security acceptance.

Stop here for independent review; no staging, commit, push or release is authorized.
