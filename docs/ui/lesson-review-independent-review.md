# Submission, history and administrator review — independent review

Latest review: **2026-10-30 — C1 independently verified and resolved within
its correction scope; no new actionable finding. R1 remains resolved.**
All 99 browser cases, 20 focused rendered cases, 135 request/state tests, lint,
standard TypeScript and the matching build are source/hash-verified reused
evidence, not fresh independent suite executions. Fresh source/geometry checks
passed; fresh browser execution is blocked by EPERM. Live API/database and manual
acceptance remain pending. See [C1 independent verification](#c1-independent-verification--2026-10-30).
Earlier findings, blocked attempts and handoffs below are historical.

## Findings first

### R1 — P2: keep history associated with its original lesson

- **Location:** `frontend/src/lib/lesson-review-state.ts:232–235`;
  affected consumers: `frontend/src/components/lesson-review-panel.tsx:426–480`.
- **Trigger:** as administrator, inspect pending lesson A, use **Reload revision
  history**, then inspect pending lesson B. Comments may be empty, or explicitly
  discarded when choosing B.
- **Impact:** `detail()` changes `lessonId` and `selected`, but retains A's
  `history`. The UI displays A's titles, decisions and workflow metadata under
  B's lesson ID. **Read revision** combines B's ID with A's revision ID and gets
  404; **Next history page** applies A's cursor to B and can skip B's revisions.
  The exact-detail/decision defenses still prevent this from approving A as B;
  no unauthorized read, persisted corruption or wrong approval was demonstrated.
- **Correction:** clear history when changing lessons, or key/display all history
  metadata, revision links and cursors using the history page's own lesson ID.
  Add a two-lesson regression covering detail, history and pagination together.
- **Evidence performed:** a database-free Node probe called the actual
  `createReviewState()` with well-formed fixture responses in the sequence
  `detail(A, revisionA)`, `history(A)`, `detail(B, revisionB)`. Assertions confirmed
  `state.lessonId === B` while `state.history.workflow.lessonId === A` and the
  retained item was `revisionA`. The printed result was
  `REPRODUCED: selected lesson B retains history of A; UI Read revision constructs /lessons/B/revisions/A-revision.`
  The incorrect URL follows directly from the inspected button handler; a live
  HTTP request/browser interaction was not performed.

This is an application correction, separate from all verification gaps below.
No application or test fix was made during the original review. The implementation
correction is recorded in the follow-up at the end of this document.

## Scope and repository identity

- Branch verified: `feat/frontend-lesson-review`.
- HEAD/checkpoint verified: `2b96627`, whose parent is the reported base.
- Actual merge base with `e9c0ff4`, `staging` and `origin/staging`:
  `e9c0ff45c264a8d08614c5b3f01163dc4d779842`.
- Reviewed the entire base-to-workspace feature, not just the working-tree diff:
  16 checkpoint files plus subsequent unstaged changes, 18 feature files total
  before this review's documentation. Ten files were unstaged on entry; no
  untracked files or staged changes were present.
- Inspected checkpoint and working-tree changes separately, final new modules,
  request/state tests and fixtures, all rendered test bodies, and the
  whitespace-insensitive editor diff. Backend, migrations, manifests and npm
  lockfiles have no feature changes.
- Read root `AGENTS.md`, its referenced project documents, the
  [workflow contract](../lesson-review.md), [UI contract/evidence](lesson-review.md),
  [draft contract](../teacher-drafts.md), frontend auth/session and shared
  navigation contracts, and relevant implementation. No scoped instruction file
  applies to changed files.

### Contract audit

Source inspection found no additional actionable defect in these paths; this is
not a claim that their browser/live integration passed:

- Teacher preparation requires a saved, clean, unblocked draft and synchronously
  locks saves/source actions. History/current-detail reads verify the saved
  version and retain baseline revision number, candidate content/origin/sources.
  NestJS remains authoritative for completeness and transitions. Materials can
  explicitly be `[]`; required-field/timing/source guidance is visible in source.
- Submission sends only `expectedVersion`; exact mutation responses validate
  target/state/version, with candidate matching before retiring the editor.
  Immutable detail renders stored content, snapshots and exact review as text,
  without replacing historical snapshots from current resources.
- History/detail are owner/admin API reads; submitted/approved lessons do not
  use editable draft detail. The known-ID teacher discovery limitation is
  documented in the UI: no endpoint lists all submitted lessons. UUID cursor
  order is distinct from revision chronology and queue freshness.
- Administrator decisions require exact current/unreviewed SUBMITTED detail,
  viewed lesson version, explicit confirmation, and appropriate comments.
  Raw UTF-16 length/NUL checks and backend-trimmed feedback are accounted for.
  Queue/history requests use supplied cursors, subject to R1's target mix-up.
- Duplicate writes are synchronously excluded. Conflicts retain work, block
  further decisions, and require fresh exact comparison plus explicit acceptance.
  Wrong-target or malformed mutation responses become uncertainty, not success.
- Lost/aborted/503/invalid responses do not retry. Submission recovery starts
  history at page one, follows cursors, identifies baseline + 1 and compares the
  immutable candidate, even after later review/resubmission. Review recovery
  targets the original revision and distinguishes competing decisions. Failed
  reads clear acknowledgement eligibility. Absence never proves failure or
  unlocks another write; acknowledgement is explicit.
- Recoverable failures retain draft text/comments. Pauses invalidate generations,
  abort reads and convert active writes to uncertainty; confirmed session changes
  dispose stores. Late successes/401s cannot replace current state. Persistent
  navigation protection covers pending/uncertain writes separately from dirty
  comments/draft text. Existing resources and draft behavior remain in place.

## Verification ledger

All commands were sequential. No browser worker, frontend/backend server,
database, dependency installation or build was started for this review.

| Classification | Check | Result / boundary |
|---|---|---|
| Performed | Branch, log, actual bases, complete feature/checkpoint/unstaged diff, index and untracked inspection | Expected branch/base/checkpoint confirmed; index empty |
| Performed | Memory before verification | WSL exposes 3,858 MiB, not the host's full 8 GB; initially 1,302 MiB available and 193 MiB swap used, later 1,256 MiB available and 198 MiB swap used; no heavy rerun attempted |
| Performed | SHA-256 comparison with `/tmp/lessonforge-review-gu3f1zc6/frontend` | All 50 application/test/configuration files match byte for byte; digest below |
| Reused, not rerun | Request/state suite | Prior recorded 123 passed, including 26 workflow and 97 regression cases, on identical source |
| Reused, not rerun | Lint and standard `next typegen && tsc --noEmit` | Prior recorded passes on identical source |
| Reused, not rerun | Isolated one-worker Webpack production build | Prior recorded exit 0; matching copy and its `BUILD_ID` remain present; no fresh build/pass claimed |
| Performed | Independent two-lesson store probe | Reproduced R1 with actual state module and mocked reads; no server/database |
| Performed | Static TypeScript-AST expansion of literal rendered-case loops | 91 cases = 74 existing + 17 workflow; all 34 original top-level test definitions/loops unchanged from base; test bodies/hooks not executed |
| Performed | Read all 91 expanded cases' definitions, fixtures and assertions | Coverage limitations below; authored assertions are not passing browser evidence |
| Performed | Installed Playwright executable preflight | Resolves `/home/mariga/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`; file absent |
| Performed | Existing Playwright CLI `install --help` | Confirms supported `install chromium` syntax only; no installation |
| Blocked / not launched | Rendered suite, viewport screenshots, actual keyboard/focus/status/layout behavior | Missing Chromium; zero browser cases ran in this review |
| Environment restriction | Initial AST comparison using Node `execFileSync('git', ...)` | Reported EPERM; shell `git show` followed by in-process AST comparison succeeded; not an application test failure |
| Environment restriction | `ss -ltn` for ports 3000/3210 | Netlink socket denied; cannot establish listener absence from this attempt; no server started and no process terminated |
| Performed | Whitespace and review documentation links | Final validation recorded below |

The identity manifest includes `src/**`, `test/**`, `eslint.config.mjs`,
`next.config.ts`, `package.json`, `package-lock.json`, `postcss.config.mjs` and
`tsconfig.json`, with sorted relative `path SHA256` rows and a trailing newline.
Digest: `ec8e8e9081a34a1ff0fb3ceecb6a14dfedc6573d8a2d0acb6eb6fb5ffdf914aa`.
This independently matches the digest in [prior evidence](lesson-review.md#verification-evidence--2026-10-29).
The README and ignored generated `next-env.d.ts` differ in that copy; the latter
points to production `.next/types` rather than workspace `.next/dev/types`.
Neither is included in the 50-file source identity assertion. In particular,
the reused standard typecheck is the isolated-copy result, not a fresh workspace
typecheck. Prior build/process restrictions and interrupted attempts remain
historical; they are not reclassified as product failures or successful checks.

## Verification gaps, not additional demonstrated application blockers

- The 17 new rendered cases are 12 single cases plus five viewport iterations at
  320/390/768/1024/1440px. They author assertions for saved-only submission,
  validation, duplicate clicks, write/navigation uncertainty, historical sources,
  both decisions, comments/focus, stale versions, competing outcomes, session
  pause/replacement, wrong detail and permissions. None has run here.
- They do not cover a two-lesson administrator history switch (R1), workflow
  history/queue next-page interaction, or a complete browser changes-requested →
  reopen/edit/save/resubmit cycle. Existing resource pagination is not workflow
  pagination coverage. API cursor and state resubmission tests help but do not
  establish those rendered interactions.
- Raw 4,000-unit/over-limit/NUL review validation and queue full-page ordering
  deserve focused boundary assertions; the visible logic alone is not a test.
- Mocked browser/API fixtures do not establish live authorization, transaction
  ordering, immutable database rows, CORS/cookies/CSRF, or real concurrent actors.
  Earlier backend evidence is historical and unchanged, not rerun here.
- Actual viewport composition/overflow, Tab order, confirmation/error focus,
  status announcements, screen-reader behavior, Firefox/WebKit, and guarded live
  API/browser acceptance remain pending. See the [manual checklist](lesson-review.md#numbered-manual-checklist--all-pending).

### Supported user-controlled Chromium setup — not executed

With the currently installed Playwright module, run this only when ready to allow
browser downloads (no npm package installation is needed):

```bash
node /home/mariga/design-work/lessonforge-ui/node_modules/playwright/cli.js install chromium
```

This downloads the Chromium/browser helper artifacts required by that Playwright
version into `/home/mariga/.cache/ms-playwright` by default. It needs outbound
network access, a writable cache and sufficient disk space for downloads and
extraction. It does not install missing Linux shared libraries or change system
configuration. A custom `PLAYWRIGHT_BROWSERS_PATH` must name a writable directory
and be set identically for installation and execution; do not rely on the absent
old `/tmp` browser/library paths. Missing system libraries would be a separate
prerequisite requiring the user's decision, not permission granted by this review.

Independent preflight on 2026-10-29 confirms installed Playwright **1.64.1**,
`PLAYWRIGHT_BROWSERS_PATH` unset, and the executable above still absent. The
read-only `/sbin/ldconfig -p` inventory has no entries for `libnss3.so`,
`libnspr4.so` or `libasound.so.2`; their normal
`/usr/lib/x86_64-linux-gnu` paths are also absent. `LD_LIBRARY_PATH` is unset and
the former `/tmp/lessonforge-ui-browser-libs/extracted/usr/lib/x86_64-linux-gnu`
directory is absent. NSS, NSPR and ALSA runtime libraries therefore also need to
be made available before browser execution. This inventory is not an exhaustive
Chromium dependency/launch check: the binary is unavailable. The download command
does not supply those OS libraries; no browser or system installation was run.

After installation and a matching production build, first check memory with
`free -m`, ensure port 3210 is available, and run only this single-worker harness:

```bash
PLAYWRIGHT_MODULE=/home/mariga/design-work/lessonforge-ui/node_modules/playwright/index.mjs npm run test:browser --prefix frontend
```

It starts/stops one production frontend on port 3210 and intercepts API traffic;
do not run another development server or a concurrent suite. It is not a live
NestJS/database test. The [existing integration guide](frontend-design-integration.md#recorded-automated-verification)
also documents optional package/system-library installation for other setups;
none was performed or authorized here.

## Documentation changes, checks and final Git state

Added this record and linked it from the UI index and workflow implementation
record, preserving the earlier evidence as historical/reused evidence. Only these
three documentation files were edited by the reviewer; application/test files
were not modified. Source identity was checked again after documentation edits.

Final whitespace/link validation: `git diff --check e9c0ff4` passed; all local
Markdown targets in the three affected review documents exist. The index remains
empty. The ten pre-existing unstaged files remain modified, plus this new
untracked review record (two of those existing files received review links).
HEAD remains `2b96627` on `feat/frontend-lesson-review`. No staging, commit, push,
merge, branch switch, reset, cleanup, system change or unrelated process kill
was performed.

## R1 correction follow-up

2026-10-29: **R1 corrected, awaiting independent verification.** This is the
implementation follow-up to the original review, not an independent re-review.
Existing checkpoint and unstaged work were preserved on
`feat/frontend-lesson-review` at `2b96627`.

The store now changes the active lesson synchronously before a history/detail
read, clears the previous lesson's history, selected detail, comments (only after
the existing explicit-discard guard), conflict/comparison eligibility and errors,
then starts the new read. A target change may supersede a read only: its generation
is invalidated before abort, so a transport ignoring cancellation cannot publish
obsolete A data/errors/401s over B, or clear B's pending state. A cancelled
submission-preparation read releases its draft hold; confirmations, pending writes,
uncertain recovery and authentication pause/disposal keep their existing guards.
No write is retried and no version is adopted by this correction.

History display rejects incompatible ownership, and revision buttons/page actions
use `history.workflow.lessonId` with that page's revision IDs/cursor. The store
rejects obsolete pagination actions unless their lesson and cursor match the
currently retained page. Lesson/revision/cursor inputs are normalized to lowercase
before identity comparisons, preserving valid uppercase UUID inputs. This is a
UI action guard, not a change to the backend's UUID cursor contract. Same-lesson
paging retains the exact selected detail.

`frontend/test/lesson-review-targets.test.mjs` adds 12 database-free cases using two
lessons with separate 21-revision histories. They cover immediate A→B invalidation,
B-only detail IDs/cursors, failed B history/detail reads, delayed A history/detail
successes/availability failures/401s, late A completion while B remains pending,
same-lesson pagination/detail retention, comments, confirmations, pending writes
and exact-target uncertain recovery, plus uppercase UUID compatibility. Delayed
transports deliberately ignore abort.

Fresh checks ran **sequentially**, with the Node suites restricted to one worker:

| Check | Actual result |
|---|---|
| Initial 11-case matrix before application correction | 10 failed, 1 passed: reproduced the target/state defects |
| `node --test --test-isolation=none --test-concurrency=1 test/lesson-review-targets.test.mjs` | 12 passed, 0 failed on final correction/test source, including the added UUID compatibility case |
| `npm test -- --test-concurrency=1` | 135 passed, 0 failed: all prior 123 cases plus 12 R1 cases |
| `npm run lint` | Passed, exit 0 |
| Standard `npm run typecheck` (`next typegen && tsc --noEmit`) | Passed, exit 0 |
| `git diff --check` and full feature whitespace check | Passed |
| Production build | Not rerun: local state/UI-handler change, no route/dependency/build-configuration changes, required checks passed; earlier build is historical |
| Rendered, viewport/keyboard/focus and live API/database browser acceptance | **All 91 rendered cases and live acceptance remain pending**; Chromium unavailable, no installation or browser launch attempted |

Tests ran from the workspace frontend. Lint/typecheck used the fresh copy
`/tmp/lessonforge-ui-r1-_ksax48a/frontend`, excluding all `.env*`, `.next` and the
TypeScript cache, with a symlink to the installed workspace dependencies. The
prior `/tmp/lessonforge-review-gu3f1zc6` evidence copy was not modified. All 51
current application/test/config files matched the fresh copy byte for byte.
Using the same sorted SHA-256 manifest convention as above, the correction digest
is `8e1a9b58538c750389c29ad3fb8a49e954b5b2960f2f24a3e215cea0a5be90cb`.
The earlier 50-file identity and its reused check/build results apply only to
the pre-correction source; they are not substituted for these fresh checks.

Memory was checked before verification: WSL exposes 3,858 MiB; available memory
was 1,552 MiB before the final complete suite, 1,536 MiB before final lint and
1,661 MiB before final typecheck. Swap use at those observations was 571/571/598
MiB respectively. No
resource failure or OOM was reported. No concurrent suites, servers, browser
workers, database access, dependency installation, system configuration changes
or unrelated process termination occurred.

The manual two-lesson scenario is added to step 6 of the implementation checklist.
It remains pending in a real browser, along with the existing 91 rendered cases,
live authorization/CSRF/concurrency acceptance and other manual checks. The added
state tests and source inspection of the owner-bound button handlers do not claim
rendered evidence. Independent confirmation of this correction is still required.

Final whitespace checks (`git diff --check`, `git diff --check e9c0ff4`) passed,
and all 17 relative documentation link targets in the three affected UI documents
exist. Git remains on `feat/frontend-lesson-review` at `2b96627`, index empty:
11 tracked files are modified and two files are untracked (this preserved review
record and the new R1 test file). All earlier changes/checkpoint commits remain;
no staging, commit, push, merge, branch change, reset or cleanup was performed.

## R1 independent correction verification — 2026-10-29

**Verdict: R1 resolved; no actionable defect found in the scoped correction.**
This independent review inspected the actual working-tree correction and focused
regressions, rather than relying on the implementation follow-up's verdict.
Root `AGENTS.md` (no applicable scoped override), its referenced project guides,
the backend workflow contract and both UI review records were read. No
application or test code was changed by this verification.

### Invariants independently checked

- **A history → inspect B:** `selectLesson()` updates the active ID and clears
  incompatible history, selected detail, stale errors and comparison eligibility
  synchronously, before starting the request. Failed B history/detail reads leave
  B's ID/error without A's results. Comment-discard and confirmation guards still
  run before changing targets.
- **Owning IDs/cursors:** source inspection of `WorkflowView` confirms that only
  history matching the active lesson renders, and revision/page handlers capture
  that history's own `workflow.lessonId`, revision ID and `nextAfter`. The store
  rejects a cursor not belonging to its retained page; same-lesson pagination
  retains selected detail. Canonical lowercase comparisons accept uppercase UUID
  inputs. The API validates response ownership and ascending cursor order.
- **Late A responses:** the generation changes before aborting a superseded read;
  success/error/401 publication and pending-state updates require the current
  generation. Focused tests deliberately ignore abort, including A completing
  while B is still pending.
- **Session and writes:** pause/disposal guards remain intact. Confirmation,
  pending-write and uncertain-write states prevent lesson switches; recovery
  targets the original revision and does not retry writes or adopt versions.
  Existing submission recovery still scans history from page one and compares
  the retained baseline/candidate, including after review/resubmission.

### Actual independent evidence

All commands ran sequentially with installed dependencies and Node **24.21.0**.
Before tests, `free -m` showed 3,858 MiB total, **1,828 MiB available**, and
369 MiB swap used; a later preflight showed 1,764 MiB available and 369 MiB swap
used. No heavy build, server, browser, database or parallel worker was started.

| Classification | Check | Actual result / boundary |
|---|---|---|
| Fresh | From `frontend`: `node --test --test-isolation=none --test-concurrency=1 test/lesson-review-targets.test.mjs test/lesson-review-api.test.mjs test/lesson-review-state.test.mjs` | **38 passed, 0 failed/skipped/cancelled**, exit 0: 12 R1 target cases, 8 API cases, 18 workflow-state cases; database-free mocked reads/writes |
| Fresh | Independent inline Node probe using the actual store and fixture, no persisted test file | Three scenarios passed: a B history read supersedes A submission preparation, releases the draft hold, rejects its late confirmation and sends no submit; paused target switches remain blocked and late read success/401 cannot restore detail or end the session |
| Fresh | Sorted `path SHA256` manifest and byte comparison with `/tmp/lessonforge-ui-r1-_ksax48a/frontend` | All **51** application/test/configuration files match; no extra source/test files in the copy; digest `8e1a9b58538c750389c29ad3fb8a49e954b5b2960f2f24a3e215cea0a5be90cb` matches the correction ledger |
| Reused, not rerun | Full request/state suite, lint and standard `next typegen && tsc --noEmit` | Correction ledger's **135 passed**, lint exit 0 and standard typecheck exit 0 apply to the identical source; these are not fresh independent runs |
| Historical only | Pre-correction production build | Not rerun; the old build does not establish a production build of the corrected source |
| Fresh | Playwright module/executable preflight; existing CLI `install --help`; loader inventory | Module 1.64.1 imports, documented install syntax supported, Chromium absent, additional missing library entries documented above; no install or launch |
| Pending, not run | Rendered suite and live API/database browser acceptance | **All 91 rendered cases remain pending**, as do viewport/keyboard/focus/status/layout checks, rendered two-lesson switching/pagination and real authorization/CSRF/concurrent-actor acceptance |

Node emitted the existing `MODULE_TYPELESS_PACKAGE_JSON` warning while importing
TypeScript; no test failed. A first attempt to inspect Playwright's formerly
separate `nativeDeps.js` found no such file in this installed package layout;
the read-only loader inventory above is the actual library evidence, not a
claimed Playwright host-dependency validation.

The 38 tests and three probes verify store/API behavior only. Button ownership is
source-inspected, not browser-clicked. They do not execute or replace any of the
91 rendered cases, establish live API/database behavior, or close the numbered
manual checklist. Earlier backend/production/browser evidence remains historical.
The exact supported download command and prerequisites are recorded in
[Chromium setup](#supported-user-controlled-chromium-setup--not-executed).

### Documentation and Git boundary

Only `docs/ui/README.md`, `docs/ui/lesson-review.md` and this preserved review
record were updated by the independent verifier. Earlier finding/implementation
ledgers remain historical; their awaiting-verification statements describe their
original handoff, not the current verdict. No application/test files were edited,
dependencies installed, system settings changed, servers duplicated, files cleaned,
or Git staging/commit/push/merge/branch operations performed.

Git remains on `feat/frontend-lesson-review` at `2b96627`, with an empty index.
The same **11 tracked modifications and two untracked files** present on entry
remain: tracked `docs/ui/README.md`, `docs/ui/lesson-review.md`, `frontend/README.md`,
`frontend/src/components/lesson-review-panel.tsx`,
`frontend/src/components/lessons-panel.tsx`, `frontend/src/lib/lesson-review-api.ts`,
`frontend/src/lib/lesson-review-state.ts`, `frontend/test/lesson-review-api.test.mjs`,
`frontend/test/lesson-review-state.test.mjs`,
`frontend/test/rendered/foundation.test.mjs`,
`frontend/test/support/review-fixture.mjs`; untracked
`docs/ui/lesson-review-independent-review.md` and
`frontend/test/lesson-review-targets.test.mjs`.

Final validation passed: `git diff --check`, `git diff --check e9c0ff4`, all 17
relative documentation file targets in the three review documents, and explicit
trailing-whitespace/final-newline checks (including this untracked record).
The post-documentation 51-file source manifest still matches the correction
digest above. Final status confirms the branch/HEAD, empty index and file list
reported here.

## Browser-correction independent review — 2026-10-30

### Findings first

**C1 — P2: do not realign visible array fields for distant group hints.**

**Implementation handoff (historical):** corrected, awaiting independent verification; see
the [fresh C1 correction evidence](lesson-review-browser-verification.md#c1-shared-guidance-focus-correction--2026-10-30).
The finding/verdict below records the reviewed pre-correction source and is
retained as history. This status is an implementation handoff, not independent sign-off.

- **Location:** `frontend/src/components/lessons-panel.tsx:243–248`;
  related fixed alignment: `frontend/src/app/globals.css:60–64`;
  actual shared-description consumers: `lessons-panel.tsx:337–366`.
- **Trigger:** focus an already-visible learning-objective/material item whose
  shared fieldset hint, above earlier rows, has scrolled behind the toolbar.
  Each item references that same hint at `lessons-panel.tsx:366`.
- **Impact:** the new handler treats the distant group hint as a local clearance
  failure, then snaps the input to toolbar height + 3 rem. The hint remains
  offscreen, so repeated focus among visible rows causes unnecessary jumps with
  no improvement in guidance visibility. Unlike the previous native focus
  behavior, this moves controls whose own label and input already fit. This is
  a presentation regression, not evidence of lost content or wrong writes.
- **Recommendation:** distinguish local field descriptions from shared fieldset
  guidance, scroll only for a feasible local visibility improvement and use the
  measured local bounds to choose a minimal destination. Add rendered coverage
  for focus between multiple already-visible array items, preserving pointer
  source-action behavior. Wrapped labels and resized fields also deserve focused
  checks rather than assuming the Title case proves all field-group clearance.
- **Independent evidence:** executed the actual callback extracted by the
  TypeScript AST, with synthetic DOM rectangles and the current CSS alignment
  (16 px root, 240 px toolbar, 900 px viewport). A visible array input at
  y=500–578 moved to y=288 while its shared hint moved from y=0 to y=-212.
  An 80 px label-to-control offset left the label at y=208 under that toolbar.
  A 520 px textarea with a following 90 px hint ended with hint bottom y=902,
  although moving the local group 10 px higher would fit it with 8 px clearance.
  These are **deterministic callback/geometry probes, not measured browser
  coordinates**. Source inspection confirms the shared hint relationships and
  fixed alignment. The shared-hint jump is the demonstrated new handler
  regression; the other rectangles illustrate alignment limits, not separately
  established new baseline regressions. Fresh browser confirmation was blocked
  as detailed below.

**Verdict:** one P2 correction remains; hold correction sign-off for C1. No
P0/P1 or additional workflow-integrity blocker was found. Previously resolved
R1 remains fixed. The seven original failing cases have valid current-source
passing evidence; that evidence does not cover C1. Live API/database and manual
acceptance remain pending independently of this code finding.

### Scope and every documented correction

Reviewed root `AGENTS.md` and its project guides, `docs/lesson-review.md`, the UI
implementation record, original independent/R1 records and the entire browser
verification record. No scoped instruction file applies to these changed files.
Verified `feat/frontend-lesson-review`, HEAD/checkpoint `2b96627`, and actual merge
base `e9c0ff45c264a8d08614c5b3f01163dc4d779842` with both staging references.
Inspected base-to-workspace changes, the checkpoint separately, subsequent
unstaged changes and all untracked files. Backend, migrations, manifests and
lockfiles are unchanged by the feature.

Comparison with the pre-browser-correction copy at
`/tmp/lessonforge-browser-20261030-tz26v82a/frontend` confirms that the actual
browser correction changes only `lessons-panel.tsx`, `globals.css` and
`test/rendered/foundation.test.mjs`. Earlier request/state/R1 corrections were
included in review, not mistaken for browser-correction changes.

| Original/additional issue | Independent assessment |
|---|---|
| Wrapped toolbar hides focused title | Toolbar height is read initially and on ResizeObserver delivery, including fractional heights. Wrapping, viewport width changes, status/error text and font/layout changes that change toolbar dimensions are observed. The CSS variable is local to the mounted editor. Reused rendered checks cover five widths. Remaining field-group alignment is C1, not a stale-height finding. |
| Guidance assertion reads wrong wrapper | It now starts from the actual Title control's current `aria-describedby`, requires that referenced hint to be visible and still match `/required for submission/`, and asserts no invented `aria-invalid`. This control has one description ID. Text preservation, enabled Save, no revision and no uncertainty checks remain. |
| Five pointer-origin focus assertions | Actual Tab reaches teacher confirmation; Enter still submits. Admin comments → Tab reaches approval. The helper separately checks active element, `:focus-visible`, a nonhidden outline of at least 2 px and computed contrast >=3:1 against both the button and nearest painted surrounding background. Current surfaces are opaque/solid, so these comparisons are meaningful for this design. This is not universal visual/screen-reader acceptance. |
| Native timing validation leaves guidance/error below viewport | The callback includes current labels and all referenced descriptions; passing browser cases check native-invalid focus and its guidance/error at all five widths. This fixes that observed case, but fixed input-only alignment is not general field-group clearance (C1). |
| RGB-only parser rejects valid `oklch(...)` background | Canvas converts computed CSS colors to sRGB; alpha must be opaque before contrast is calculated. Contrast thresholds were not reduced. |
| Source heading still uses fixed utility margin | `scroll-mt-40` was removed from the real source heading, so the measured descendant rule can apply. Both introduction and source fragment-target checks remain and passed in reused evidence. |
| Focus scrolling cancels pointer selection click | Pointer-focused actions are excluded; keyboard actions and text controls retain clearance. The original source POST/version/text-preservation assertions remain and pass. The callback exclusion was also independently probed. |
| Initial editor title pushed below viewport | CSS is limited to descendants of following toolbar siblings; the callback excludes nodes preceding the toolbar. Initial heading focus is unaffected. All five unchanged D1 initial-open cases passed in the reused 12-case focused run and full run. |
| R1 history A → detail B association | Store clears incompatible history synchronously, aborts/invalidates superseded reads, and rejects obsolete cursors. UI handlers capture the displayed history owner's lesson ID. Fresh 12-case target suite passed, including late success/errors/401, pending B, uppercase IDs, comments and write/uncertainty guards. Rendered A/B pagination remains a manual gap, not claimed fresh browser evidence. |

Observer cleanup disconnects the one locally created observer on editor
close/unmount/session replacement; no new global listener or timer exists.
Measurement writes only a CSS custom property used by scroll margins, not toolbar
size or React state. Source inspection found no measurement/render feedback loop
or server/client hydration difference: DOM reads occur in the client layout
effect, and the initial server/client store snapshots remain unchanged. Mocked
callback delivery and disconnect were independently checked; actual browser
resize/font-change lifecycle checks could not be added in this environment.

Submission still locks saved-draft operations synchronously, sends only the saved
expected version, and retires only a validated matching candidate. Exact revision
and mutation response checks, immutable content/origin/source rendering, baseline
history recovery, competing-decision handling, explicit comparison/acknowledgement,
no automatic write retry, generation invalidation, session isolation and pending/
uncertain navigation protection remain intact by source inspection and the reused
request/state/rendered evidence. Browser corrections touch none of these state or
request contracts. No live authorization, transaction or database proof is inferred.

### Checks performed and evidence reused

Execution was sequential. Initial `free -m`: 3,858 MiB total, 1,608 MiB available,
733 MiB swap used; before launch preflight, 1,589 MiB available. A later sample
showed 1,595 MiB available and 743 MiB swap used. No build or full suite was
repeated, no server was started, and no parallel browser worker was used.

| Classification | Check | Actual result |
|---|---|---|
| Fresh | Byte/hash verification of final `source-scoped-manifest.sha256`, workspace and production verification copy | All **56** inputs match; manifest SHA-256 `c6f19f69cb93b4cd102b1f2ea193f6d10b23ee15404bbf0481a542e058dda0cc`; production `BUILD_ID` is `G8SVg6YyiC-HPm6D_6GoP` |
| Fresh | Read and SHA-256 all six final logs listed in browser correction ledger | Every digest matches that ledger; logs substantiate the reused results below |
| Reused, not rerun | Full single-worker rendered suite / focused suite | **91/91** and **12/12**, no failed/skipped/cancelled/todo cases; complete workflow paths reached at 320/390/768/1024/1440 px |
| Reused, not rerun | Request/state, lint, standard TypeScript, Webpack production build | **135/135**; lint/typecheck/build passes. The final presentation-only adjustment did not change request/state test inputs. This is source-matched recorded evidence, not fresh independent execution |
| Fresh | From `frontend`: `node --test --test-isolation=none --test-concurrency=1 test/lesson-review-targets.test.mjs` | **12 passed**, 0 failed/skipped/cancelled/todo, exit 0; Node 24.21.0, existing typeless-package warning only |
| Fresh | TypeScript-AST extraction and VM execution of current clearance/layout-effect callbacks | Local measurement values followed growing/shrinking/fractional toolbar heights; pointer-action and preceding-heading exclusions, keyboard/short-field clearance and observer disconnect passed. C1 reproduced under explicit synthetic geometry; no real layout claimed |
| Fresh | AST-printer comparison of base/pre-correction/current rendered test call definitions | All **35** feature-base call definitions retained; only the clearance case changed. All **48** pre-correction definitions retained; exactly three changed (clearance, backend guidance, parameterized keyboard workflow). Read their diffs and fixture/hook changes: no workflow assertion removed, skip introduced, timeout increased or automatic suite retry added |
| Blocked preflight | Local socket / Chromium launch | `ss -ltn` cannot open netlink; direct loopback port-3210 bind returns **EPERM**, so listener availability cannot be established. Existing Chromium launch with recorded process-local runtime paths fails at `sandbox_host_linux.cc:41`, `shutdown: Operation not permitted`. No app server/full browser test was launched; this is an environment limitation, not a product failure |

Temporary independent callback script and output:
`/tmp/lessonforge-independent-clearance-probe.cjs` and
`/tmp/lessonforge-independent-clearance-probe.log`. The script reads source,
extracts callbacks with installed TypeScript, and mocks geometry; it does not edit
or replace application/tests. Earlier final logs and their hashes remain in the
[browser record](lesson-review-browser-verification.md#full-suite-regression-and-final-scoped-correction).
A prior saved 320 px clearance screenshot was inspected only as supporting
historical layout evidence, not as new manual acceptance.

### Documentation changes, limitations and Git state

Updated only this review record, the UI index, workflow UI record and browser
verification record to surface C1 and link the current verdict while retaining
all historical evidence. Application/test files were not changed. No dependencies
were installed, system settings changed, duplicate servers started, files cleaned,
or staging/commit/push/merge/branch operations performed.

The earlier manual checklist remains entirely pending, including live NestJS/
PostgreSQL, real actors/permissions/concurrency, CSRF/cookie/HTTPS, assistive
technology, visual acceptance and other browsers. Fresh resize/font-layout browser
probes are blocked here; the synthetic probe is not a substitute for those checks.

Final documentation validation and Git status are recorded below.

Final validation passed: `git diff --check`, `git diff --check e9c0ff4`, explicit
whitespace/final-newline checks for all four review documents (including untracked
records), and all 24 relative Markdown file-link targets. After documentation
edits all 56 source inputs still match the verified manifest; no application or
test content changed.

Final Git state: `feat/frontend-lesson-review`, HEAD `2b96627`, empty index,
**12 modified tracked files and three untracked files**, the same file set as on
entry. Tracked: `docs/ui/README.md`, `docs/ui/lesson-review.md`, `frontend/README.md`,
`frontend/src/app/globals.css`, `frontend/src/components/lesson-review-panel.tsx`,
`frontend/src/components/lessons-panel.tsx`, `frontend/src/lib/lesson-review-api.ts`,
`frontend/src/lib/lesson-review-state.ts`,
`frontend/test/lesson-review-api.test.mjs`,
`frontend/test/lesson-review-state.test.mjs`,
`frontend/test/rendered/foundation.test.mjs`,
`frontend/test/support/review-fixture.mjs`. Untracked:
`docs/ui/lesson-review-browser-verification.md`,
`docs/ui/lesson-review-independent-review.md`,
`frontend/test/lesson-review-targets.test.mjs`.

## C1 independent verification — 2026-10-30

### Findings first and independent verdict

**No new actionable finding. C1 is independently verified and resolved within
this presentation correction's scope.** R1 remains resolved. This conclusion uses
source-matched recorded browser results, independent source inspection and fresh
callback probes; it is not a claim of fresh independent browser execution or
manual acceptance. The earlier P2 finding above describes the pre-C1 source.

Read root `AGENTS.md`, its five project guides and the latest UI implementation,
independent review and browser verification records. No additional scoped project
instruction applies. Compared the actual pre-C1 verified source at
`/tmp/lessonforge-rendered-correction-_qjhf2ft/frontend` with the workspace and
final C1 verification copy. Exactly three of the 56 recorded inputs changed:
`src/components/lessons-panel.tsx`, `src/app/globals.css` and
`test/rendered/foundation.test.mjs`.

| Requested behavior | Independent assessment and evidence boundary |
|---|---|
| Shared guidance accessibility | Objective/material fieldset and textarea description IDs, referenced hint text, label associations and subject/grade descriptions are retained. The new marker excludes shared hints only from scroll geometry. The new browser cases assert both field and fieldset associations. No hiding or removal of guidance was introduced. |
| Visible objective/material rows | Four new browser cases cover both groups at 320/1024 px with the hint above the toolbar, checking forward/backward Tab and unchanged scroll position. Fresh callback probes independently give zero scroll for visible rows with distant shared hints. |
| Obscured fields and local errors | Bounds include actual labels and every non-group description/error. Fresh probes verify exact minimum deltas, e.g. -28 px for an obscured label and +62 px for a bottom local error, then zero further movement. Mixed shared/local descriptions retain the local error. Wrapped feasible bounds and scroll-limit/subpixel cases pass. These numbers are synthetic geometry, not browser coordinates. |
| Oversized content and wrapped toolbar | Fresh probes verify the local-span → label/control → control fallback, stability for intersecting oversized controls, one-time useful reveal for wholly offscreen controls, fractional/growing/shrinking toolbar measurement and observer cleanup. The reused resized-toolbar, wrapped-label and oversized browser cases pass; all five workflow widths remain covered. |
| Native Tab, defaults, entry/exit and focus | There is no new key handler, `preventDefault`, `stopPropagation`, `.focus()`, tabindex or DOM reordering. Native Tab/Shift+Tab traversal and row entry/exit retain the identical controls, disabled states and browser defaults; there is no custom row cycle, trap or focus reassignment. Only native array textarea/Remove-button scroll margins change to toolbar height + 8 px; callback label measurements provide the remaining clearance. Global focus-visible outlines are unchanged. Adjacent-row keyboard movement is browser-covered; first/last-row entry/exit and row focus-ring rendering were **not separately freshly browser-probed** here. |
| Pointer focus and other controls | Pointer-action exclusion is retained and freshly probed; input/select/textarea pointer focus still receives measured clearance. Toolbar controls and preceding headings remain excluded. Existing source-selection clicks, normal editor controls and initial-open behavior remain covered by the matching rendered suite. No fresh pointer/browser claim is inferred from mocked geometry. |
| Session/navigation/workflow protection | AST comparison confirms the entire component outside the two clearance/measurement callbacks and new data attributes is unchanged from pre-C1. Request/state stores, transport, workflow panel, protection registration and auth/session key are unchanged. No callback writes content or moves focus. Existing navigation, pending/uncertain write, immutable snapshot/version and session regressions remain in the matching 99 browser / 135 state evidence. No live authorization/database proof is inferred. |

### Blockers and resource boundary

Checked memory before any execution: about **1.6 GiB available**, with **1.0 GiB
swap nearly full** (a later exact sample: 1,639 MiB available, 1,022/1,024 MiB swap
used). Work remained sequential; no full suite, lint, typecheck or build was
repeated. A single loopback port-3210 bind attempt returned **EPERM**. A single
headless Chromium preflight using the already-installed documented process-local
runtime failed at `sandbox_host_linux.cc:41`, `shutdown: Operation not permitted`.
No app server or browser test was started; no retry or permission bypass was
attempted. This is an execution-environment blocker, not a product test failure
or evidence of an OOM. A later memory sample had 1,678 MiB available and the same
1,022 MiB swap used. No dependency installation, system changes or unrelated
process termination occurred.

### Performed checks and reused evidence

| Classification | Actual check/result |
|---|---|
| Fresh | Manifest digest `2c49d9f3aeab2e554f2476da43e694a5df7f0f77c4252ff6ea79b0454099c21f` verified; **all 56 inputs** match both workspace and `/tmp/lessonforge-c1-correction-jvzbxn3z/frontend`. Production `BUILD_ID`: `CsE1y89z-p9kEDgRuY6VJ`. |
| Fresh | Read and independently verified SHA-256 of all six final logs against the C1 ledger: build, targeted, lint, TypeScript, state and complete browser run. All match. |
| Fresh | `node /tmp/lessonforge-c1-independent-probe.cjs`: **24/24 synthetic geometry/lifecycle cases pass**, plus complete component AST and scoped CSS boundary assertions; exit 0. This extracts/transpiles the current callbacks with installed TypeScript and executes them in a mocked DOM/VM. No browser layout or native keyboard result is claimed. |
| Fresh | Pre-C1/current rendered test comparison: **one insertion of 269 lines**, no deletions/replacements. All original 91 cases/assertions/timeouts remain. Inspected all eight new cases and their setup/preconditions; no skipping, retries, assertion weakening or timeout increase was added. |
| Reused, not rerun | **99/99 browser cases**, including all eight new C1 cases, and **20/20 targeted rendered cases**; no failed/skipped/cancelled/todo cases. Source-matched production build and fixture APIs; all five workflow widths. |
| Reused, not rerun | **135/135 request/state tests**, no failed/skipped/cancelled/todo; lint, standard `next typegen && tsc --noEmit` and Webpack production build pass. Commands and exact log digests remain in the [C1 implementation ledger](lesson-review-browser-verification.md#c1-shared-guidance-focus-correction--2026-10-30). |
| Blocked, not run | Fresh independent native Tab/Shift+Tab boundary/default/focus-ring and pointer/resize browser checks: socket/Chromium preflight EPERM. No failed browser suite was launched or retried. |

Temporary independent artifacts (may disappear on restart):
`/tmp/lessonforge-c1-independent-probe.cjs`,
`/tmp/lessonforge-c1-independent-probe.log`, and
`/tmp/lessonforge-c1-independent-provenance.log`.
Probe script SHA-256:
`7ab193d0d91c7b76e3a73d03e1b3bc4f16dcaa49d8e3405ac24f5ed0fa1a200b`.

### Remaining limits and documentation/Git boundary

Live NestJS/PostgreSQL, real actor/permission/concurrency, cookie/CSRF/HTTPS,
manual visual/keyboard acceptance, assistive technology and other browsers remain
pending. The numbered manual checklist is not closed by this review. Fresh
independent native boundary checks remain blocked as stated above; retained
browser defaults and no trap/focus stealing are independently source-verified,
not new cross-browser or assistive-technology acceptance.

Updated only the four UI records: this review, the UI index, workflow UI record
and browser verification record. No application/test code changed. No staging,
commit, push, merge, branch change or file cleanup occurred. Git remains on
`feat/frontend-lesson-review`, HEAD `2b966275a624845f3a54bb96869535e5932e8689`,
empty index, **12 modified tracked files and three untracked files**, the same
file set as entry (listed in the preceding review's Git section).

Final documentation validation passed: `git diff --check`,
`git diff --check e9c0ff4`, explicit whitespace/final-newline checks for all four
UI records (including untracked files), and all **28 relative file-link targets**.
After documentation changes all 56 source inputs still match the verified
manifest. Final Git status confirms the branch/HEAD, empty index and unchanged
12-modified/three-untracked file set reported above.
