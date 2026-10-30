# Lesson submission, history and administrator review

Latest verification: the [2026-10-30 C1 correction](lesson-review-browser-verification.md#c1-shared-guidance-focus-correction--2026-10-30)
passed the build and all **99 browser cases, 0 failed/skipped**, including eight
new C1 regressions. Twenty focused rendered cases, 135 request/state tests,
lint and standard TypeScript also passed. Automated workflow layout/focus checks
completed at all five widths. The
[independent C1 verification](lesson-review-independent-review.md#c1-independent-verification--2026-10-30)
now resolves the prior field-group focus-clearance finding, with no new actionable
issue. It verified source/log hashes and ran 24 geometry/lifecycle probes; fresh
browser checks were blocked by EPERM, so the full checks above are reused,
not independently rerun. R1 remains resolved. Live API/database browser and
manual acceptance remain pending. Earlier browser-blocked and
failed-run statements below are historical.

## Contract map before implementation

Preparation: `feat/frontend-lesson-review`, clean working tree and empty index.
No branch operations or cleanup. Authority: [workflow API](../lesson-review.md),
[draft contracts](../teacher-drafts.md) and the existing authenticated persistent
workspaces/navigation guard. Backend code and schemas stay unchanged.

| Screen/action | Contract and permission | Frontend behavior |
|---|---|---|
| My drafts: prepare submission | Owned TEACHER editable DRAFT/CHANGES_REQUESTED; existing saved draft detail plus `GET /lessons/:id/revisions` and, when present, exact current revision detail | Require saved/clean/reconciled work. Retain saved content, origin, snapshots, expected lesson version and baseline revision number. Preparation reads never save or adopt versions. |
| Confirm submission | `POST /lessons/:id/submit`, exactly `{ expectedVersion }`, 201 | Explain saved-only content, immutable snapshot and locked editing until requested changes. One accepted click, no retries. Show authoritative result; a new revision needs review. |
| Teacher history `/history`, `/history/:lessonId` | Owner-only history/detail reads; no all-submitted-lessons list exists | Open a known lesson ID, page UUID-ascending history, explicitly select a revision. Display exact immutable content, source snapshots and review. Keep revision number separate from UUID pagination order. |
| Pending review `/admin/reviews` | ADMIN `GET /reviews/pending?limit=20&after=...` | Only supported pending queue and cursor pagination; no invented filters, search, ownership fields or ordering. Read exact detail before deciding. |
| Administrator revision detail | `GET /lessons/:id/revisions/:revisionId` | Show immutable content, origin, IDs/number, timestamps, full retained sources, review and current workflow metadata. No editable teacher draft. |
| Approve / request changes | ADMIN exact revision route; `{ expectedVersion, decision, feedback }`, 201 | Only current SUBMITTED/unreviewed revision is actionable. Required nonblank feedback for REQUEST_CHANGES, optional on approval; 4,000 raw UTF-16 units, NUL rejected. Confirmation names exact lesson/revision/version and consequence. Retain comments on recoverable failures. |
| Changes requested | Existing teacher draft APIs become editable | Explicitly return to My drafts and open/reconcile the server draft. Never adopt a workflow version into the editor automatically. No withdrawal, reopening approval, decision editing, library/copy, AI or notifications. |

All calls reuse credentialed no-store/CSRF transport and deadlines. Runtime response
validation checks exact envelopes, identities, revision targets, states, versions,
ordered pages and snapshots. History/queue pages use server cursors, not time order
or locally inferred next pages. Historical data never fetches current resources.

## Recovery and boundaries

Submission preparation holds a separate workflow lock on draft operations; dirty
content, draft uncertainty, pending saves/sources and conflicts cannot submit.
Confirmation and reads do not modify the draft's base version or saved selections.
Draft dirty state and workflow pending/uncertain state remain separate.

Lost submission responses retain the confirmed candidate and baseline number.
Explicit reconciliation starts history at page one, follows server cursors and
loads baseline number + 1 exactly. Compare immutable content/origin and sources
keyed by resource ID. A later review or resubmission changes current workflow
metadata but cannot replace that historical outcome. Matching history requires
explicit acknowledgement before leaving recovery. Missing/different results or
failed reads cannot establish failure and cannot unlock another submission.

Lost review responses reconcile only the originally targeted revision. Show its
winning decision/reviewer and distinguish a matching decision from a competing
decision; explicit acknowledgement is required. No review means the outcome is
still uncertain. Reads alone never retry a write, adopt a version or unlock it.
After a definite 409, fresh comparison and explicit acceptance are required before
another decision; comments remain associated with their target. Errors use safe
messages; only confirmed 401 ends the session.

API gaps: no teacher endpoint lists every previously submitted lesson; use known-ID
history URLs, including after reload. There is no operation-status/idempotency
endpoint: an absent candidate/review cannot prove an in-flight request failed.
Do not fabricate a safe no-match outcome or add a backend route. Backend 400 errors
contain no field-specific diagnostics; show contract guidance beside fields and
an actionable submission summary, never invented server field errors. NestJS
remains authoritative for completeness, timing sums, permissions and transitions.

Temporary auth uncertainty pauses controls, invalidates/aborts old reads and makes
interrupted writes uncertain while retaining work. Confirmed identity/role/session
replacement disposes all workspace state. Persistent stores and existing navigation
protection retain pending/uncertain recovery and protect unsaved comments/text.

## Implementation and interruption recovery

The persistent teacher workspace now coordinates its existing draft store with a
separate submission/history store. Submitted content is rendered read-only from
revision detail, including all retained snapshot fields and recorded review.
The persistent administrator workspace supports the pending queue, exact revision
inspection, comments, confirmations, both decisions and explicit recovery. There
are no new backend routes, schema changes, dependencies or browser storage.

The large `lessons-panel.tsx` diff was inspected against the pre-feature parent
with whitespace ignored. Most churn comes from indenting the original editor
under a fragment to add its sibling workflow view. Existing field/save/source,
activity identity, reconciliation and navigation handlers remain in place. The
intentional changes add submission coordination, guidance, materials' explicit
empty-array choice, history links and route visibility. No editor rewrite was
needed. Follow-up fixes show preparation's pending status and normalize cursor
case consistently before validating response order.

After WSL interruption, the prepared branch and tracked/untracked work were
inspected before editing. A later environment restart removed the temporary
verification copy and running build session; its result is **unverified**. An
external checkpoint, `2b96627`, subsequently preserved the implementation on the
same branch with a clean tree. This task did not create that commit or change
branches. Follow-up changes remain unstaged.

The final resume verified both staging references and the actual merge base as
`e9c0ff45c264a8d08614c5b3f01163dc4d779842`. Review included the entire feature diff
from that base: checkpoint `2b96627`, subsequent tracked changes and the untracked
file listing (none remained at this resume). The complete feature changes 18 files;
the 10 files modified after the checkpoint are unstaged. Backend, migrations,
package manifests and lockfiles have no feature changes. A syntax-tree comparison
confirmed all 34 original top-level rendered test definitions/parameter loops
remain unchanged; fixture additions are conditional on the workflow fixture.

Implementation and request/state coverage are complete for the contract-supported
screens/actions. Rendered/layout acceptance and live API/browser integration remain
outstanding verification. The contract limitations above remain unresolved product
capabilities; they are explicitly represented in the UI, not new backend work.

## Verification evidence — 2026-10-29

The later [independent pre-commit review](lesson-review-independent-review.md)
found P2 R1, an administrator history/lesson association defect, and missing
meaningful coverage. R1 is now independently verified and resolved; see the
[independent correction verification](lesson-review-independent-review.md#r1-independent-correction-verification--2026-10-29).
The earlier completeness statement does not establish independent acceptance.
The review distinguishes performed, source-verified reused, and blocked checks.
Chromium remains absent and none of the 91 rendered cases ran in that review or
the R1 correction. The record also includes the supported user-controlled browser
installation command and its download/cache requirements.

Use installed dependencies only. Verification copies exclude `.env*`, existing
`.next` output and TypeScript cache. No live NestJS server or database is used.
The request/state suites use mocked API/transport responses; browser fixtures
intercept API calls and are not live ownership, transaction or database evidence.
Earlier backend and UI results in other guides are historical, not reruns here.

| Check | Actual result |
|---|---|
| Initial post-interruption request/state rerun | 120 passed, 0 failed |
| Follow-up request/state run | 123 passed, 0 failed, including 26 workflow request/state cases and existing 97 regressions |
| Follow-up isolated `npm run lint` | Passed, exit 0 |
| Follow-up standard `npm run typecheck` (`next typegen && tsc --noEmit`) | Passed, exit 0 |
| Default Turbopack build in sandbox | Failed: local process/socket bind denied with EPERM |
| Permitted Turbopack rerun | Interrupted by environment restart; session/copy lost, no pass claimed |
| Webpack build in sandbox | Failed while parsing TypeScript subprocess `--showConfig` output; no compilation result established |
| Permitted Webpack production build | Passed, exit 0, including TypeScript, ten pages and build traces; page collection/generation explicitly used one worker |
| `git diff --check staging` and index check | Passed; index empty |
| Rendered and viewport preflight | Blocked: installed Playwright resolves Chromium to `/home/mariga/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`, which does not exist. Previous temporary binary/libraries are also absent. Browser suite not launched; no rendered pass claimed |

The final source copy is `/tmp/lessonforge-review-gu3f1zc6/frontend`. All 50 current
application/test/configuration files match it byte for byte. This permits reuse of
the completed 123-test, lint and standard TypeScript checks across the last resume;
those suites were not needlessly repeated. The production build was completed on
that matching copy after the previously interrupted permission request; no result
was assumed from the interrupted command (its log did not exist). The comparison
manifest sorts relative paths and hashes each file with SHA-256, then hashes the
newline-delimited `path hash` rows including their final newline. Its digest is
`ec8e8e9081a34a1ff0fb3ceecb6a14dfedc6573d8a2d0acb6eb6fb5ffdf914aa`.

Actual permitted build command, from that isolated frontend directory:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 CIRCLE_NODE_TOTAL=2 NODE_OPTIONS=--max-old-space-size=512 NEXT_TELEMETRY_DISABLED=1 npm run build -- --webpack
```

The implementation retains all 74 existing rendered cases and adds 17 workflow
cases, including five viewport iterations at 320/390/768/1024/1440px. These cover
teacher saved-only submission, duplicate clicks, backend validation, pending and
uncertain writes, failed reconciliation, historical content/snapshots, both admin
decisions, comments/focus, stale versions, competing decisions, wrong targets,
permissions, session replacement and protected navigation. Authored tests do not
establish that the browser checks passed.

On restart WSL reported 3,858 MiB total memory (the host has 8 GB), about 2,021 MiB
available and no swap use. Before the follow-up tests, available memory was
1,504 MiB with 16 MiB swap used. No OOM result or cause of the lost build was
captured. Builds and suites are run sequentially after the resource constraint
was supplied; browser tests use the existing concurrency of one. No system
configuration is changed.

Before the final build, WSL reported 1,245 MiB available and 156 MiB swap used;
afterward it reported 1,296 MiB available and 193 MiB swap used. The build used
one Next worker and a 512 MiB per-process Node heap ceiling; no resource failure
was reported. The earlier sandbox failures are environment/process-permission
failures, separate from application failures and the unconfirmed lost session.
The permitted listener inspection found no servers on frontend ports 3000/3210.
No development server, browser worker, backend or database was started, and no
unrelated process was terminated. The rendered suite remains deferred because
the browser dependency is absent; no dependency restoration was attempted.

### Local verification steps

Run one command at a time from the repository root and check memory (`free -m`)
before builds/browser tests. These commands lint, generate route types/check
TypeScript, run database-free request/state tests and compile production assets:

```bash
npm run lint --prefix frontend
npm run typecheck --prefix frontend
npm test --prefix frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 CIRCLE_NODE_TOTAL=2 NODE_OPTIONS=--max-old-space-size=512 NEXT_TELEMETRY_DISABLED=1 npm run build --prefix frontend -- --webpack
```

The final command uses installed Webpack and limits Next's worker count for that
process to one through its existing `CIRCLE_NODE_TOTAL` convention and bounds each
Node process's heap to 512 MiB; it does not edit application/system configuration.
Run in an isolated source copy excluding
real environment files when those files must not be loaded by Next.js. No API or
database is required by the build. The default build command remains unchanged.

With a usable **already installed** Linux Playwright/Chromium environment and a
completed production build, the following starts/stops one frontend test server
on port 3210 and intercepts `http://localhost:3001` requests. Do not start another
development server alongside it:

```bash
PLAYWRIGHT_MODULE=/home/mariga/design-work/lessonforge-ui/node_modules/playwright/index.mjs npm run test:browser --prefix frontend
```

Set `PLAYWRIGHT_BROWSERS_PATH` and, if needed, `LD_LIBRARY_PATH` to the existing
installation. The old `/tmp/lessonforge-ui-browsers` and browser-library paths no
longer exist. No installation/download was attempted. If tooling must be restored,
the optional developer-controlled setup commands and their effects are documented
in [the existing integration guide](frontend-design-integration.md#recorded-automated-verification).

### Numbered manual checklist — all pending

Use test accounts and disposable test lessons/resources. This checklist is for
local acceptance; it does not authorize this task to contact a development DB.

1. **Owned draft and validation.** Save an incomplete teacher draft, select a
   source, then prepare submission. Expect confirmation to explain saved-only
   content, immutable history and locked editing; a backend validation rejection
   keeps all draft fields/selections. Guidance stays beside the relevant fields.
   Fill every required field, positive section timings summing to total, one or
   more activities and at least one source. Materials may explicitly be empty.
2. **Saved-only, duplicate and pending.** Edit text without saving: Prepare is
   disabled. Save, prepare, cancel: content stays editable without a POST. Prepare
   again and confirm twice: expect one POST with the saved version, pending
   announcement, disabled conflicting controls and protected navigation/logout.
3. **Successful submission.** Expect SUBMITTED and the exact new revision ID and
   number. The editor closes; immutable content/sources are readable. History
   navigation works. Submitted/approved lessons cannot be reopened for editing.
4. **History and snapshot preservation.** Keep the known lesson history URL.
   Review/resubmit and later edit/retire its resource. Read the earlier revision:
   expect original content, origin, full source snapshot/version and original
   feedback/reviewer/time. No current-resource request should replace that data.
   Page order is UUID ascending; revision numbers express chronology.
5. **Requested changes and resubmission.** After an administrator requests changes,
   read that feedback in history, return to My drafts and explicitly reload/open
   or reconcile the editable draft. Edit/save/submit. Expect a new numbered
   revision; the earlier revision/review/sources remain unchanged.
6. **Administrator queue and exact target.** Load/reload the pending queue and
   follow a next-page cursor when supplied. Expect pending submissions only, no
   unsupported filters, and exact revision inspection before actions. Confirm
   that IDs, viewed lesson version, content and sources identify the target.
   Load lesson A's history, then inspect B: A's page/cursor/detail must disappear
   before B loads. B's history/detail links and next-page action must use B's IDs
   and cursor. Delayed A responses or failed B reads must not restore A's results
   under B; same-lesson pagination must still work. These browser interactions
   remain pending despite the database-free R1 state regressions.
7. **Decisions/comments.** Request changes with blank comments: expect nearby
   guidance and focus on comments, no POST. Enter comments: expect preserved text
   in confirmation, a 4,000 UTF-16-unit limit, required feedback and the immutable
   CHANGES_REQUESTED result. Approve another submission with optional comments:
   expect APPROVED, locked editing and no second decision on either revision.
8. **Stale/competing decisions.** Inspect the same submission in two admin sessions.
   Record one decision, then confirm the other. Expect safe 409 handling with
   comments retained. Explicitly recover the original revision; show the winning
   review. A new version is never adopted silently, and no automatic POST occurs.
9. **Uncertain submission.** With a controlled test proxy/harness, lose the response
   after commit. Expect uncertainty and no retry. Make an explicit recovery read
   fail: no acknowledgement is available. Recover successfully even after later
   review/resubmission: identify baseline number + 1 and its original snapshots,
   then explicitly acknowledge. No match must remain uncertain, not imply failure.
10. **Uncertain review and permissions.** Lose a review response, then recover only
    that exact revision. Expect matching or competing reviewer/decision shown and
    explicit acknowledgement. A missing decision/read failure stays uncertain.
    Foreign/unknown IDs and forbidden actions show sanitized failures, no private
    payloads or invented outcome; only confirmed 401 ends authentication.
11. **Session/navigation preservation.** Pause session confirmation during a read
    and a write; late responses must not replace current state. Writes become
    uncertain and resume only with explicit recovery for the same session.
    Confirmed identity/session replacement clears old work. Enter admin comments,
    cancel a navigation prompt, then deliberately visit resources and return:
    comments remain associated with their original revision. Retain the existing
    draft/resource/navigation regression checklist.
12. **Keyboard, announcements and widths.** At 320/390/768/1024/1440px, navigate all
    actions with Tab/Shift+Tab/Enter/Space. Expect visible focus, comment-error
    focus, focus on confirmations/errors, status announcements for loading/writes
    and results, readable wrapping, and no horizontal page overflow. Inspect
    snapshots and history as well as confirmations. Screen-reader and other-browser
    acceptance remain separate from any automated Chromium results. On opening a
    draft, expect its title and Save controls within the first viewport. Scroll
    and focus fields, provoke a native timing error, and follow introduction/source
    links: the sticky controls must not cover the target, its label or guidance.
    Pointer-click source actions must activate once without moving away mid-click.
    Add several objectives and materials, scroll their shared hints out of view,
    then Tab/Shift+Tab between already-visible rows: expect no page jump and intact
    accessible guidance. Resize the viewport/toolbar and textarea: useful local
    clearance should occur once; impossible oversized bounds must not cause
    repeated realignment. These human checks remain pending despite rendered passes.

Remaining acceptance includes live API/browser integration against a guarded test
environment, all manual steps above, assistive technology and other browsers.
The API gaps described above are product/contract constraints, not safe outcomes
that the frontend can infer. No deployment or approved-library action is included.

## R1 correction verification — 2026-10-29

**Corrected, awaiting independent verification.** Selecting another lesson now
sets its active ID and clears incompatible history/detail/error state before its
read starts. It invalidates and aborts the previous read generation; obsolete
successes/errors/401s cannot replace the new lesson or its pending read. The UI
renders only history owned by the active lesson and binds revision buttons and
pagination to that history's own lesson ID. Pagination accepts only the retained
page's server cursor. Same-lesson paging keeps its exact selected detail.

The correction preserves explicit comment-discard requirements and blocks target
changes during confirmations, writes and uncertainty. Recovery still reads the
original attempted revision; session pause/disposal continue invalidating reads.
No endpoint, lifecycle rule, version adoption or automatic retry was added.

The initial database-free two-lesson matrix failed 10 of 11 cases on the
uncorrected source. The final correction also normalizes UUID case to preserve
valid uppercase inputs before ownership/cursor comparison, with an additional
compatibility regression. Fresh checks ran sequentially: all 12 focused cases,
all 135 request/state tests (38 workflow plus 97
existing regressions), lint and standard `next typegen && tsc --noEmit` all passed.
Whitespace/documentation checks are recorded in the linked correction ledger.
All 51 application/test/config files matched the fresh isolated verification copy
`/tmp/lessonforge-ui-r1-_ksax48a/frontend`; real `.env*`, prior build output and
TypeScript cache were excluded, and installed dependencies were reused by symlink.

No production build was rerun for this local state/UI-handler correction: no
route, dependency or build configuration changed, and the required checks passed.
The earlier production build is historical, not evidence for the corrected source.
No resource failure was reported; memory was checked before each suite/lint/type
check. No servers, database, browser workers, installation or system changes were
needed. All **91 rendered cases**, keyboard/focus/viewport checks and live browser
acceptance remain pending. The numbered manual checklist remains unperformed.
