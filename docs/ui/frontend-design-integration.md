# Frontend design integration — Phases 1–3

## User-reported local acceptance closeout

The user reports **all eight combined manual acceptance checks from this
conversation passed**, including the previously deferred **Phase 1 navigation
checks**. This is **user-performed local acceptance**, not manual verification
performed by Codex. The report is recorded as supplied; no additional execution
steps, environment details or coverage are inferred.

| Reported acceptance | Result / attribution |
| --- | --- |
| Combined manual checks 1–8 | All eight passed — user-performed local acceptance |
| Previously deferred Phase 1 navigation checks | Passed within those eight checks — user report; no longer deferred |
| R1, D1 and D2 corrections | Corrected; automated tests passed and user manual acceptance passed |
| Independent re-verification of the corrections | Skipped by user decision; not performed or represented as independently resolved |

The navigation and correction entries describe parts of that reported acceptance,
not additional manual checks. Earlier automated evidence remains distinct:
frontend lint, standard TypeScript, 97 request/state tests, 74 rendered tests and
the Webpack build passed during implementation. These application checks were
not rerun for this documentation-only closeout.

This report does **not** establish database inspection, HTTPS/deployment or
security verification, screen-reader/assistive-technology testing, or
Firefox/WebKit coverage. Unperformed deployment/security, assistive-technology
and other-browser checks remain pending. Local browser acceptance must not be
expanded into a claim of production/deployment readiness.

This closeout supersedes earlier pending local-manual/Phase 1 navigation notes
below. Those checkpoint records remain historical. The broader ten-item
integration checklist is retained as a reference; the eight reported passes do
not imply every security, deployment or accessibility subcheck in it was run.

## Phase 3 — teacher drafts and recovery presentation (2026-10-26)

Preparation was checked before editing: branch `feat/frontend-design-drafts`,
clean working tree and empty index. `e6412cc` (Phase 1) and `fe02f64` (Phase 2)
are ancestors of the current `HEAD`; the backend lesson/resource contract and
existing production lesson API/state store are present. No branch operation,
cleanup, install, database access, staging or commit was performed.

### Independent Phase 3 review (2026-10-27)

The [independent review](phase-3-review.md) originally found **R1 (P2)**: removing an
invalid earlier activity transfers its new local timing error to a valid remaining
row, including after a successful save. It required correction before approval.
No P1 ownership, snapshot, data-loss or recovery-unblocking failure was found.

At that checkpoint two separate design-acceptance gaps remained: **D1**, normal editor instructions
and always-expanded recovery push writing below the initial viewport, and **D2**,
a newly created draft with a distinct server ID is absent from the returned list
until Reload. These behaviors are not required by production contracts. The
manual Reload workaround works; no persistence loss was observed.

Five new temporary Chromium probes completed. One reproduced R1, one characterized
D2, one measured D1/heading structure, and two checked array/reload semantics and
list feedback. Their passing harness status does not mean the findings passed
acceptance. Current lint/TypeScript/build, prior 15 affected rendered cases and
unchanged request/state evidence were reused. Two new clean-editor screenshots
were inspected independently; the earlier scrolled viewport captures do not
establish initial editor composition. Application and repository test files were
preserved. Live API/database, full manual accessibility, other browsers and the
deferred Phase 1 navigation checklist remain pending.

### R1, D1, D2 correction follow-up (2026-10-27)

**Status: R1, D1 and D2 corrected; automated tests passed and user manual
acceptance passed.** Independent re-verification was skipped by user decision.
The original independent review is retained as history; these corrections are
not represented as independently re-verified or as deployment acceptance.

Preparation confirmed `feat/frontend-design-drafts`, `HEAD`/base `fe02f64`, the
existing four tracked modifications and untracked review record, and an empty
index. Those edits were preserved. No branch changes, installs, cleanup, staging,
commits, pushes, merges, backend or migration changes were performed.

- **R1:** activity keys are local to the editor and retained with their rows
  through add/remove. They never enter API content and reset on create/open and
  session disposal. Timing feedback records the exact value that native validity
  checked. A reused field cannot announce an obsolete message for another value;
  its ref callback recomputes native validity when the value changes, including
  an invalid row moving into an earlier slot. API content, numeric values and
  backend rules are unchanged. Permanent rendered regressions cover removing an
  invalid first row with a valid remaining row, no obsolete alert/`aria-invalid`
  before and after save, a remaining invalid row receiving its own feedback,
  and invalid native number text versus an unset timing (both have an unset
  model value). The last case checks component/browser identity, not just a
  comparison of numeric values.
- **D1:** list-only instructions are hidden in the editor. The heading/close
  controls and sticky Save precede writing. Local view changes focus and align
  their heading at the viewport top so the mobile shell does not bury writing;
  optional help/limits and comparison use native disclosures. Conflict, uncertainty or a failed request opens
  recovery automatically. Enter/Space disclosure interaction does not read,
  write or adopt anything; loading latest is a separate deliberate read and
  adoption still requires its existing explicit action. Recovery and navigation
  gates are unchanged.
- **D2:** permitted editor close clears stale summaries/cursor and requests the
  authenticated first list page through the existing store request/generation
  handling. Server `nextAfter` remains authoritative; later pages are reached
  explicitly. Loading and read failure do not masquerade as empty results.
  Separate `listLoaded` presentation metadata distinguishes an interrupted/unread
  page from a confirmed empty page. Auth pause invalidates that read; after
  recovery the user chooses Reload explicitly. A failed refresh offers explicit
  Reload, never another write. Paused, pending
  and uncertain writes retain their close restrictions. No creation success is
  inferred from lists. Permanent rendered tests use a distinct server UUID,
  reopen without manual Reload, rename/return/reopen, failed refresh/recovery and
  a late response after same-user session replacement. State tests also cover
  cursor reset, late success/401 across pause/disposal and unresolved-write gates.

#### Correction verification and boundaries

These are implementation-agent checks, not independent resolution. API requests
are intercepted in Chromium; state/request checks use mocked transport. No live
NestJS API, authentication account or database was used.

| Check on correction source | Actual result |
| --- | --- |
| Repository frontend lint | Passed, exit 0; final state/rendered test-file lint also passed after the last assertion edit |
| Standard repository `npm run typecheck --prefix frontend` | Passed, exit 0 after the final application build, including generated route types |
| Request/state suite | 97 passed, 0 failed; includes five added return-list/state cases and all earlier request/state regressions |
| Webpack production build | Passed, exit 0 on final application source with the permitted process environment |
| Focused browser checks | 11 correction cases passed before the last identity/read-status refinement; two added native-input/auth-pause cases then passed on the final build; all 13 also passed in the final complete run |
| Complete rendered suite | 74 passed, 0 failed/canceled/skipped on final source/build, including all 13 permanent correction additions and the Phase 1/2 regressions |
| Initial editor visual checks | Ten initial open/create captures inspected at 320/390/768/1024/1440px, height 900px; Title and Save visible, compact idle help/comparison and no horizontal overflow |
| Scrolled Save and snapshot regression | Passed in the complete suite: Save visibility, writing/snapshot columns, retained text and separate source preconditions at all five widths |
| Final preservation / documentation checks | All 35 source/test hashes match the manifest recorded before the final complete run; 25 local file/anchor targets and `git diff --check` passed |
| Manual evidence boundary | Codex ran no live API/database acceptance. User-performed local acceptance is recorded above; database inspection, deployment/security, assistive technology and other-browser coverage are not inferred |

The permanent rendered additions cover R1's valid and invalid remaining rows,
invalid native number text versus an unset value, both normal editor view
transitions at every requested width without test-forced scrolling, Enter/Space
on disclosure controls, read-only comparison without adoption, failed inspection
and conflict exposing recovery, distinct-ID create/return/open, renamed summaries,
list loading/failure/explicit recovery, and stale/interrupted reads across session
replacement and temporary auth uncertainty. Normal transitions align the focused
local heading; lower-field scrolling occurs only after initial measurements and
captures. Existing anchor tests explicitly open the optional help containing the
shortcuts; retained-work assertions require the recovery summary to remain
reachable, with expanded controls asserted in actual recovery cases.

The first exploratory full rendered run had 66 passes and five failures: two
mobile initial-view failures fixed by heading alignment, an inconsistent fixture
summary/detail title, and two assertions that counted Next.js's empty route
announcer as an application error. The fixture now obeys the production response
contract; assertions reject nonempty alerts and obsolete field associations.
A later 72-case full run passed before the final activity-identity/list-status
edge cases were added. After adding `listLoaded`, one earlier isolation assertion
needed to distinguish immediate disposal (initial state) from a subsequently
successful empty list (loaded state); the revised test asserts both boundaries,
and all 97 request/state cases then passed. These exploratory results do not
substitute for the final-source checks.

The first sandboxed Webpack attempt failed with the previously recorded
TypeScript `--showConfig` parsing error. Permitted builds passed; the final one
includes local row identities and confirmed-list status. No dependency/browser
installation, real API/database access or cleanup command was used. The default
Turbopack check was not rerun. Earlier evidence is historical context; new checks
above replace the earlier frontend lint/typecheck/build/request/state/rendered
results for correction acceptance.

Commands used from the repository root:

```bash
npm run lint --prefix frontend
npm run lint --prefix frontend -- test/lessons-state.test.mjs test/rendered/foundation.test.mjs
npm run typecheck --prefix frontend
npm test --prefix frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm run build --prefix frontend -- --webpack
PLAYWRIGHT_MODULE=/home/mariga/design-work/lessonforge-ui/node_modules/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/tmp/lessonforge-ui-browsers \
LD_LIBRARY_PATH=/tmp/lessonforge-ui-browser-libs/extracted/usr/lib/x86_64-linux-gnu \
npm run test:browser --prefix frontend
```

The focused invocations use the same Playwright environment and Node runner with
`--test-isolation=none --test-concurrency=1` and patterns `Phase 3 corrections`
or `local row identity|paused return read`. Logs are retained in
`/tmp/lessonforge-phase3-corrections-{state,rendered,focused,final-rendered,identity-pause,complete-rendered}.log`;
initial captures are `/tmp/lessonforge-phase3-corrections-{open,create}-{width}.png`.
The `rendered` log is the failing exploratory run, `final-rendered` is the
72-case intermediate pass, and `complete-rendered` is the final-source run.
Source/test hashes are recorded in
`/tmp/lessonforge-phase3-corrections-source-hashes.json` for final comparison.

At this correction checkpoint, local manual acceptance was still pending. The
user subsequently reported all eight combined local checks passed, including the
deferred Phase 1 navigation checks, as recorded in the closeout above. Independent
re-verification was skipped by user decision. Database inspection is not inferred;
unperformed deployment/security, assistive-technology and other-browser checks
remain pending. Keep the numbered three-phase checklist below as a reference.

Stopped for independent review on `feat/frontend-design-drafts`. Six tracked
files are modified (the preserved editor/rendered/integration/index edits plus
lesson state and state tests), and `docs/ui/phase-3-review.md` remains untracked.
The index is empty and all work is unstaged. Current implementation changes are
limited to the lesson panel/store and their tests; documentation records the
changes/results. No branch operation, dependency installation, cleanup, database
operation, staging, commit, push or merge was performed.

### Design reference and adaptation

Historical note, 2026-10-26: the initial Phase 3 report said the handoff was
missing and described only an older static teacher-resource wireframe. That
inspection actually used the sibling `/home/mariga/design-work/lessonforge`
directory; it did not establish absence at the requested `lessonforge-ui` path.
The missing-reference claim is corrected here and retained as history.

On 2026-10-27 the user supplied the recovered **LessonForge design handoff**
(approved 2026-10-23). Its full text was available in the conversation and read
from `/home/mariga/design-work/lessonforge-ui/DESIGN_HANDOFF.md`, together with
`components/drafts-workspace.tsx`, `components/lesson-fields.tsx`, and
`app/globals.css` in that reference project. These are the current design
references. The older wireframe is not the Phase 3 source of truth.

### Recovered-handoff comparison and corrections (2026-10-27)

The expected branch remains `feat/frontend-design-drafts`. The four unstaged
Phase 3 files from the initial implementation were preserved; the index was
empty and there were no untracked files. The interrupted alignment had already
completed its source/contract comparison and begun presentation changes; it had
not verified those changes or updated this record. Work resumed from that state.

| Area | Comparison and current adaptation |
| --- | --- |
| Already satisfied | Local `/drafts` create/open/editor selection, incomplete saves, exact optional numbers/arrays and whitespace, separate source writes, server snapshots, version preconditions, explicit reconciliation/adoption, auth pause/disposal, and dirty/pending/uncertain navigation protection use production APIs/stores. |
| Draft list | Replaced plain buttons with neutral cards containing API title, last-saved timestamp and version. The list is a local view; creation recovery keeps list pages/candidate inspection visible beside retained editing. |
| Writing and snapshots | Added the approved `xl` writing/300px snapshot columns, stacking below `xl`, with `min-width: 0`. Snapshots retain separate neutral read-only cards, subject/grade, full text and explicit source controls. |
| Save presentation | Replaced the initial bottom-fixed bar with the approved top-sticky neutral status/Save bar and restrained shadow. Its submit button belongs to the content form so native validation still runs. Saved time/version, unsaved edits, saving, auth pause, conflict, uncertainty and request errors remain explicit. |
| Fields and feedback | Added optional Mathematics/Grade 4 selectors with Not set, section headings, associated limits/hints, native numeric validity messages, local open/close heading focus and focused server-error feedback. No completeness or timing-sum validation was added. |
| Recovery placement | Moved production comparison/recovery controls above the writing/snapshot columns; all acknowledgement, candidate inspection and version-adoption gates stay in the existing store. |

Production adaptations intentionally retained:

- Objective/material entries stay separate labeled textareas so embedded newlines
  are preserved as part of each array item. Unset arrays, explicit empty arrays,
  blank strings, whitespace, and blank versus zero timings keep their semantics.
  The title also remains a textarea because the production string contract
  accepts line breaks; changing it to the preview's single-line input could strip
  valid entered text.
- The stable page `h1` remains **My drafts**; local editor/list changes focus their
  `h2`. The preview uses a changing editor `h1`. Production labels such as
  **New manual draft**, **Close editor and discard unsaved text**, and the more
  explicit reconciliation/source-action labels are retained.
- Source browsing uses server pages and an explicit active detail read before
  selection, rather than the preview's complete local catalog. Recovery remains
  available above the editor even without a current error, and uncertain
  creation retains candidate/list controls rather than hiding all list content.
- The handoff's statement that production panels compose on `/` describes its
  earlier checkpoint. Merged Phases 1/2 already adopted production routes and a
  persistent session-keyed shell; this alignment retains them.

Preview behaviors excluded because they conflict with production contracts:
browser-assigned IDs, owners, versions/timestamps and full local lists; string
numeric/multiline draft payloads; local snapshot capture and simulated resource
updates; scripted failure/auth modes and browser-storage persistence; exact local
creation-ID/no-write shortcuts; generic departure from unresolved writes; and
resuming retained text after a confirmed 401 or new session. NestJS ownership,
actual session identity/expiry, numeric/array payloads, server pagination/capture,
unknown-ID candidate inspection, explicit no-match acknowledgement and strict
navigation/disposal rules remain authoritative. No preview data, storage keys or
simulation controls were added to application source.

### Initial Phase 3 changes (2026-10-26)

- `/drafts` uses the existing persistent teacher workspace and provides draft
  list, create/open, loading, empty and error feedback. Editor selection remains
  local; no draft ID appears in the URL.
- The initial editor kept Save draft visible in a viewport-pinned control bar.
  The recovered-handoff follow-up replaces that bar with the approved top-sticky
  presentation while retaining status and native content-form submission.
- Objectives and materials are edited as separate labeled array entries. This
  preserves embedded newlines and leading/trailing whitespace per entry, unlike
  a joined one-item-per-line textarea. Empty arrays remain empty until an item is
  explicitly added; blank and zero timing values remain distinct.
- Editable lesson text remains separate from read-only, server captured resource
  snapshots. Select, remove and explicit refresh use the existing separate
  versioned source mutations. Ordinary content saves do not update snapshots.
- Existing state/API recovery remains in use: conflict blocking, exact-target
  detail reconciliation, explicit acknowledgement/adoption, creation candidate
  inspection and explicit no-match acknowledgement, no retries, temporary auth
  pause with retained text, and disposal after confirmed session end/replacement.

No backend contracts, authorization, database/migrations, snapshot rules or
dependencies changed. Submission, approval/review, library, AI and autosave were
not added. The existing test fixtures remain test-only.

### Initial Phase 3 verification (2026-10-26; historical)

| Check | Result / boundary |
| --- | --- |
| Frontend lint | Passed, exit 0 on updated application source |
| Standard repository TypeScript (`npm run typecheck --prefix frontend`) | Passed, exit 0 |
| Request/state suite (`npm test --prefix frontend`) | 92 passed, 0 failed; mocked transport/state |
| Webpack production build | Passed, exit 0; sandbox attempt hit the recorded `--showConfig` parsing failure, elevated retry passed |
| Full rendered suite | 59 passed, 0 failed on the updated production build; Chromium with intercepted API responses |
| Focused Phase 3 create/reopen/edit/save regression | 1 passed; checks exact array strings, whitespace, embedded newlines, zero timing, saved reopen, unsaved status, pinned Save and overflow at 320/390/768/1024/1440px |
| `git diff --check` | Passed |
| Real API/database browser checks | Not run; no full integration acceptance claimed |

The first rendered attempt exposed a non-visible Save control at one scroll
position; the control was changed to remain viewport-pinned. Its rerun passed.
The earlier full rendered run also had one unrelated 1024px screenshot timeout
while waiting for browser fonts; the complete rerun passed that viewport. No
screenshot/visual comparison was performed in that initial Phase 3 pass. The
recorded 59-case rendered result predates the recovered-handoff corrections.
Its unaffected behavior evidence and 92 request/state tests are reused; they
are not claimed as a full rerun of the revised presentation. Manual keyboard
order, assistive technology, zoom, supported browsers, real API/database
persistence and the deferred Phase 1 manual navigation checks remain pending.

### Recovered-handoff follow-up verification

Production API/state/auth/navigation implementations, backend contracts and
schema/migrations are unchanged. Request/state and unaffected Phase 1/2 results
above are reused. Focused current-source rendered checks cover the revised
editor, field semantics, snapshots, errors, recovery/session controls, anchors
and viewport layout. Intercepted API/fixture evidence cannot establish live
database persistence, cookie behavior or full integration acceptance.

| Follow-up check (2026-10-27) | Actual result / boundary |
| --- | --- |
| Repository frontend lint | Passed, exit 0 |
| Standard repository `npm run typecheck --prefix frontend` | Passed, exit 0, including configured generated route types |
| Webpack production build | Passed, exit 0 in the actual checkout, using the previously permitted process environment; compilation, TypeScript, page generation and traces completed |
| Affected rendered Chromium cases | 15 passed, 0 failed, 0 canceled; existing production build with intercepted API |
| Source/layout visual-capture rerun | 1 passed after refining screenshot positions to show complete source cards/actions at all five widths; application source unchanged |
| Server-error focus assertion rerun | 1 passed; pending/uncertain recovery also verifies focus on the failed-read alert, retained text, blocked departure and explicit acknowledgement/adoption |
| Final affected-file ESLint / `git diff --check` | Passed; component and rendered harness linted again after the final assertion/capture edits |
| Editor/snapshot screenshot inspection | 10 viewport captures reviewed at 320/390/768/1024/1440px; writing, source cards/actions and Save fit; no horizontal overflow; stacked below `xl` and two columns at 1440px |
| Request/state suite and unaffected Phase 1/2 cases | Reused prior 92 passing request/state tests and the unaffected portion of the earlier 59-case rendered suite; not rerun wholesale |
| Real API/database, full manual accessibility and deployment checks | Not run; still pending |

The 15 selected cases cover create/save/reopen/edit with exact multiline arrays
and zero timing; draft card metadata; local heading focus and keyboard movement;
associated native validation/hints; absent context/arrays versus explicitly set
context and blank timings; select/remove/Refresh while retaining writing and
sharing lesson-version preconditions; both editor-anchor/history guard modes;
dirty Back/Forward, pending/uncertain departures, exact-result recovery, failed
candidate inspection, late writes, temporary session pause, confirmed 401,
user/role/session replacement and expiry. The two narrow reruns above repeat
affected cases rather than adding two distinct cases to the count of 15.

Commands run from the repository root:

```bash
npm run lint --prefix frontend
npm run typecheck --prefix frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm run build --prefix frontend -- --webpack
PLAYWRIGHT_MODULE=/home/mariga/design-work/lessonforge-ui/node_modules/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/tmp/lessonforge-ui-browsers \
LD_LIBRARY_PATH=/tmp/lessonforge-ui-browser-libs/extracted/usr/lib/x86_64-linux-gnu \
node --test --test-isolation=none --test-concurrency=1 \
  --test-name-pattern='Phase 3|fragment history: editor anchors|pending/uncertain teacher|TEACHER session uncertainty|confirmed 401|unknown-ID creation|confirmed (user|role|session) replacement|role/session replacement|dirty navigation retains work' \
  frontend/test/rendered/foundation.test.mjs
```

Build and rendered checks used the previously approved local process/socket
permission; no dependency or browser installation was attempted. The two narrow
browser reruns use the same environment/runner with patterns
`Phase 3 handoff: responsive writing` and
`pending/uncertain teacher writes block navigation`. Captures remain under
`/tmp/lessonforge-phase3-handoff-{writing,sources}-{width}.png`. Screenshot review
is agent visual evidence using test content and written design specifications;
the separate preview was not started and no pixel comparison is claimed.
Full draft-list visual acceptance, keyboard order, screen-reader/assistive
technology, zoom, Firefox/WebKit, live teacher/admin persistence and snapshots,
actual cookies/security, and the deferred Phase 1 manual Back/Forward checks
remain pending. The default Turbopack check was not repeated; its earlier
environment limits remain recorded below.

Historical stop after recovered-handoff alignment, before independent review:
`feat/frontend-design-drafts` had only
`frontend/src/components/lessons-panel.tsx`,
`frontend/test/rendered/foundation.test.mjs`, this integration record and the UI
index modified. At that checkpoint all changes were unstaged, with an empty
index and no untracked files. No branch operation, install, cleanup, database operation,
stage, commit, push or merge was performed.

### Final integration checklist — all phases

Reference checklist retained from implementation. Current local acceptance is
the user's report of all eight combined checks above, including the formerly
deferred Phase 1 navigation checks. Do not interpret this broader checklist as
evidence of database inspection or unperformed deployment/security,
assistive-technology or other-browser verification.

1. **Phase 1 shell/auth:** with real teacher and administrator accounts, verify
   role navigation, sign-in/session restoration/logout/expiry and cookie/CSRF/CORS
   behavior; check focus, keyboard, zoom and assistive technology.
2. **Phase 1 navigation protection:** complete the deferred manual Back/Forward
   and fragment checks for dirty, pending and uncertain work in both guard modes;
   confirm URL/workspace synchronization, retained text, blocked departures and
   reachable recovery controls.
3. **Phase 2 teacher resources:** verify real API pagination, direct UUID detail,
   reload, active/retired behavior, plain text and cross-account authorization.
4. **Phase 2 administrator resources:** verify durable create/edit/retire,
   version conflicts, exact comparison/adoption and session/navigation recovery.
5. **Phase 2 snapshot preservation:** while a real lesson has a selected source,
   edit/retire that resource; ordinary content save must preserve the captured
   snapshot, explicit refresh must capture the latest active version, retired
   sources must remain readable/removable, and refresh must fail without loss.
6. **Phase 3 draft workflow:** create and save incomplete content, reopen after
   reload, verify version increments and no submitted revision, and preserve
   optional fields, empty arrays, whitespace, embedded newlines and blank versus
   zero timings.
7. **Phase 3 sources and concurrency:** verify source selection/removal/explicit
   refresh separately from content saves; exercise duplicate/five-source limits,
   two-tab conflicts, stale preconditions and explicit comparison/adoption.
8. **Phase 3 failure/session recovery:** exercise validation, 500/502/503/504,
   committed writes with lost responses, exact-target reads, wrong/failed/stale
   candidate inspection, explicit acknowledgement/no-match, temporary auth pause,
   401/expiry and confirmed account/session replacement. Assert one write only.
9. **Cross-phase accessibility and visuals:** test keyboard-only use, focus,
   labels, status/error announcements, sticky Save visibility and horizontal
   overflow at 320/390/768/1024/1440px; record browser and visual evidence.
10. **Deployment boundary:** verify the intended HTTPS cookie, CORS/CSRF, rate
    limits, expiry and cross-account behavior separately; do not infer deployment
    readiness from local mocked or database checks.

### Explained preview steps

The recovered reference is a separate preview application at
`/home/mariga/design-work/lessonforge-ui`. With its existing dependencies,
`npm run dev --prefix /home/mariga/design-work/lessonforge-ui` starts its design
preview at `http://127.0.0.1:3105`; view `/drafts` there for presentation only.
This command was not run during alignment and the reference project was not
modified. Its simulated authentication/storage/controls are not integration
evidence. To preview the actual implementation, use the existing LessonForge
startup commands in the Phase 2 section below, sign in with privately configured
accounts, then open `/drafts`. That app uses the real API/database when configured;
the rendered tests instead intercept API responses.

## Phase 2 — resource browsing and management (2026-10-26)

The following Phase 2 entry describes its original review checkpoint. Current
Phase 3 status and the recovered design reference are recorded above.

Preparation matched the request: branch `feat/frontend-design-resources`, clean
working tree and empty index, with the Phase 1 shell, persistent workspaces,
shared controls and independently corrected R1 navigation guard present. No
branch operation, fetch, repository cleanup, staging or commit was performed.
The Phase 1 record below is historical; its deferred navigation checks were
subsequently reported passed in the user-performed local acceptance closeout.
Phase 2 stops here for commit review; Phase 3 is unimplemented. The
[independent Phase 2 review](phase-2-review.md) found no commit blockers. Its
non-blocking heading hierarchy issue is corrected in the
[R1 follow-up](phase-2-review.md#r1-heading-correction-follow-up). Resource card and
editor headings are `h2`; teacher detail sections are `h2`, while administrator
detail subsections and retirement confirmation are `h3` beneath its resource
title. Visual classes and behavior are unchanged. Manual acceptance remains pending.

### Changes and design rationale

- `/resources` renders server summaries as neutral resource cards. Only API title,
  subject, grade, active/retired status, version and update timestamp are used.
  Existing `limit=20`, `after` and `nextAfter` pagination remains authoritative;
  Next page replaces the current page and Reload list returns to the first page.
- `/resources/[id]` loads exact UUID detail independently of list data. The
  persistent workspace owns the page heading, including the loaded API title.
  Reload resource offers explicit read recovery. Pending or failed teacher reads
  hide previously loaded detail, including when a resource becomes unavailable.
  Content and citation render as plain text. No fictional descriptions, extra
  sections, static detail paths, citation fetching or preview data were added.
- `/admin/resources` keeps list/detail/create/edit views local to its mounted,
  session-keyed store. Cards, read-only metadata, fixed subject/grade fields,
  labeled content fields, sticky status/save controls, focused error messages,
  success notices and retirement confirmation use the Phase 1 visual system.
  Back to resource list goes through the leave policy; the new store `close`
  action refuses entered, pending, uncertain and paused work.
- Retirement confirms the currently viewed version. Retired detail is read-only
  and explains that existing lesson snapshots are unchanged. Comparison reads
  keep entered text and the original version visible; adoption and subsequent
  saves remain explicit. If a comparison discovers retirement, retained editing
  controls and saving are disabled rather than replacing the entered text.
- Unknown-ID creation deliberately exposes list pages and candidate detail while
  the form is retained. Exact-target reads, acknowledgement eligibility, explicit
  version adoption, no automatic write retries, authentication pause/invalidation,
  identity/session disposal and stale-response rejection retain production store
  semantics. Resource changes do not call lesson writes or refresh snapshots.

Design adaptations: production UUID routes replace preview slugs; summaries have
no descriptions, so cards show metadata rather than invented excerpts. The
production comparison/reconciliation controls remain more explicit than the
preview. Administrator server detail is displayed above retained edits so both
can be compared; generic preview departure confirmation cannot bypass uncertain
writes. All five resource fields and backend validation/contracts are unchanged.
No backend, migration, dependency, browser-storage or Phase 3 change is included.

### Phase 2 verification

Implementation verification used isolated source copies under `/tmp/lessonforge-phase2-*`, excluding real
`.env*` files and generated output, and reuses installed dependencies. No backend
or database was started or contacted. Rendered tests use installed Chromium and
intercept API responses; fixture persistence is not real database evidence.

The initial standard repository command, `npm run typecheck --prefix frontend`,
failed in `tsc --noEmit` on malformed generated `.next/dev/types/routes.d.ts` and
`validator.ts`. The isolated pass excluded those development-generated inputs
and did **not** establish a passing standard repository check at that time.
During independent review, both files were already valid before any generator
ran, and the standard repository command passed. Their earlier corruption cannot
be dated to before or during Phase 2 from the available evidence. No cleanup was
performed. See the [exact diagnostics, evidence and remediation](phase-2-review.md#typecheck-discrepancy).
A restricted repository Webpack attempt failed parsing a
TypeScript subprocess's `--showConfig`; permitted isolated builds passed. One
check accidentally ran from the repository root (which has no `package.json`)
and was rerun from the frontend copy. These failed attempts are not passes.

The initial rendered run passed 52/54 cases: one startup skip-focus assertion
and one incorrect new expectation that Skip to content must be blocked during
uncertainty. The harness now waits for guard initialization, allows accessible
in-page focus, and checks that subsequent Back traversal remains protected.
No navigation policy was weakened. Later results must be read separately below.

| Phase 2 check | Result |
| --- | --- |
| Frontend lint | Passed on final application source |
| Initial standard repository typecheck | Failed: malformed `.next/dev/types` files; not an application-source pass |
| Isolated route generation and TypeScript | Passed on final source with fresh production types; excluded repository development-generated types |
| Independent standard repository typecheck | Passed on 2026-10-26; development-generated files were already valid before the check |
| Frontend request/state suite | 92 passed, 0 failed |
| Webpack production build | Passed, including compilation, TypeScript, generation and tracing |
| Corrected intermediate rendered Chromium suite | 54 passed, 0 failed; precedes final heading refinement and two added cases |
| Final-source complete rendered Chromium suite | 56 passed, 0 failed; no page runtime errors |
| Additional focused viewport/save-bar checks | 5 passed, 0 failed at 320/390/768/1024/1440px |
| Final rendered-harness lint, formatting and `git diff --check` | Passed |
| Heading correction: focused rendered outlines | 2 passed; current-source development server with intercepted API; teacher/admin outlines, direct reload and confirmation focus |
| Heading correction: repository lint and standard TypeScript | Both passed, exit 0; full-suite/build rows above predate this correction |

### User-reported Phase 2 checks

The user reports passing teacher resource browsing, server pagination and
direct-detail reload; administrator create/edit persistence and retirement;
unsaved-navigation protection; and visual/keyboard checks. These are recorded as
user-reported checks, not agent-observed browser or database results. The report
did not specify date, browser, test resources, or whether each persistence check
used a live API/database versus fixtures, so it cannot establish those details or
replace integration evidence below. The user skipped additional independent
verification after the focused heading tests. Those tests remain the recorded
independent check for the P3 heading correction only.

The independent review also passed 39 targeted request/state/navigation tests and
10 additional Chromium probes against the matching existing production build.
Those are mocked/rendered evidence, separate from the implementation runs above;
see the [review commands and limits](phase-2-review.md#checks-and-evidence).

The 56-case final rendered run covers direct UUID detail without list loading,
plain-text content and unavailable-detail hiding; server-cursor pagination and
empty pages; required-field validation, successful create/reopen, administrator
validation/conflict text retention, comparison and explicit version adoption;
cancel/confirm retirement with the viewed version and retired read-only output;
unknown-ID resource candidate inspection and failed reinspection; authentication
pause, late-write rejection, confirmed disposal and session isolation; and the
existing dirty/pending/uncertain link, fragment and Back/Forward regressions in
Navigation API and fallback modes. These remain mocked/rendered checks.

Resource list/detail and administrator list/editor screenshots were inspected at
320/390/768/1024/1440px. Automated checks assert horizontal fit, associated labels,
keyboard movement from title to citation, visible skip-link focus, and focused
server-error feedback. Full-page captures of scrolled editors relocate fixed/
sticky elements, so five additional viewport captures and geometric assertions
verified that Save stays within the viewport and the focused citation field
clears the save bar. All five passed and their viewport screenshots were inspected.
This is a focused agent visual inspection with test content, not a full manual
design-fidelity, zoom, complete keyboard-order or assistive-technology pass.
Screenshots are temporary artifacts under `/tmp/lessonforge-phase2-*.png`.

The final application build and state checks used
`/tmp/lessonforge-phase2-review/frontend`. Its changed application and state-test
files were byte-compared with the review workspace. No package installation or
browser download was performed. The existing preview Playwright module and
`/tmp/lessonforge-ui-browsers` Chromium installation were reused with the environment
overrides documented below. Production build command:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm run build --prefix frontend -- --webpack
```

This compiles the frontend using the installed Webpack build path and embeds the
public API origin. It does not migrate or seed data. The default Turbopack build
was not rerun for Phase 2; earlier Phase 1 limitations remain recorded below.

### Local preview and remaining checks

Use the existing privately configured database and provisioned accounts. From the
repository root, in separate terminals:

```bash
npm run start:dev --prefix backend
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm run dev --prefix frontend -- --hostname localhost --port 3000
```

These start the API and frontend without resetting, seeding or migrating data.
Open `http://localhost:3000/sign-in`; sign in as teacher for `/resources`, and as
administrator for `/admin/resources`. Open a real list link to test a UUID detail
and reload its URL directly. Verify create/edit/conflict/recovery and cancel/confirm
retirement with controlled test resources; existing lesson snapshots must remain
unchanged. Restarting/reloading loses unsaved in-memory edits after a permitted
browser departure. No credentials or account fixtures are provided by this UI.

The existing test commands and installed Playwright environment overrides in the
Phase 1 record below still apply. No installation was needed. Real API/database
browser integration, real pagination datasets, snapshot preservation through a
live administrator edit/retirement, deployed authentication/cookies/HTTPS, zoom,
assistive technology and Firefox/WebKit remain pending. Screenshot inspection
and mocked Chromium checks cannot close those items. Phase 1 manual Back/Forward
checks remain deferred until after Phase 3 by the earlier user decision. Full
integration acceptance and the teacher-draft checklist remain pending.
The user-reported general unsaved-navigation pass does not close the specifically
deferred Phase 1 draft Back/Forward cases. Full draft workflows and real lesson
snapshot preservation through resource edits/retirement remain pending.

## Historical Phase 1 record

## Scope and checkpoint

Phase 1 only, on `feat/frontend-design-foundation`, based on staging commit
`130dd79278ab2ab72e5417e2b1aa31e5cc6a33a6`. The working tree was clean before
implementation; a fresh `git fetch origin staging` confirmed the same base.
After a WSL reload, the existing unstaged implementation was inspected and
continued. At resume, shell/routes and state changes were present; documentation
was absent, rendered verification was outstanding, and lint/build completion was
uncertain. The implementation and recorded checks below were completed, but the
[independent pre-commit review](phase-1-review.md) found navigation blocker R1.
A focused correction is described in the [R1 follow-up](phase-1-review.md#r1-correction-follow-up).
R1 is now resolved by [independent correction verification](phase-1-review.md#independent-correction-verification).
Real API/database and unperformed manual acceptance checks remain pending. No
staged work existed. No staging, commit, push, merge, dependency
installation, database access or migration is part of this work.

The approved source is `~/design-work/lessonforge-ui/DESIGN_HANDOFF.md`.
Only presentation and interaction intent are integrated. Resource and draft
screen redesigns (Phases 2 and 3) remain outstanding.

## Changes and reasons

- Shared Tailwind classes and native reusable controls provide neutral Arial
  typography, 44px controls, visible focus, wrapping and responsive spacing.
  Textareas have explicit label/ID associations: browser investigation found
  that the old wrapping labels included loaded textarea text in label lookup.
  The text had been retained; the reusable labeled control fixes the association.
- The shared layout owns authentication and mounted resource/draft workspaces.
  Routes select visibility rather than remounting an editor. Teacher navigation
  offers Resources and My drafts; administrators see Manage resources.
- `/sign-in` uses the existing authentication transport/provider, with persistent
  labels, associated errors, password visibility and clearing on submission.
- Navigation protection reads current store state before acting: dirty work
  requires confirmation and stays in memory; pending/uncertain writes block
  navigation, logout and discard without a confirmation bypass. Browser
  traversals use the Navigation API or an indexed history fallback. Reload/close
  request the browser's native warning; browsers can still allow departure.
  The review identified a fallback escape through native fragment-history entries;
  see [finding R1](phase-1-review.md#r1--p1-blocker-fragment-history-bypasses-the-fallback-navigation-guard).
  The correction manages in-page anchors, retains the committed route/URL, checks
  navigation links even on the same path, repairs permitted unmarked entries
  through Next.js, and restores the visible editor for blocked unknown entries.
- Administrator resources now have store-level authentication pause/invalidation,
  matching lesson workspaces. Interrupted writes become uncertain; late results
  cannot adopt data or versions. Recovery requires explicit reconciliation.
  Starting another read invalidates prior acknowledgement eligibility; a failed
  list read cannot release creation uncertainty or reuse an earlier candidate.
- Confirmed resource/lesson 401s immediately end the frontend session. Absolute
  expiry also clears it, including a focus/visibility check after backgrounding.
  Cookie-changing requests still serialize even if expiry occurs while pending.

## Affected files

- `frontend/src/app/{layout,page,globals.css}` and route pages under `sign-in/`,
  `resources/`, `drafts/`, and `admin/resources/`.
- `frontend/src/components/application-shell.tsx`, `ui-controls.tsx`, and
  `workspace-navigation.tsx` own shared presentation and navigation.
- Existing `auth-panel.tsx`, `auth-provider.tsx`, `lessons-panel.tsx` and
  `resources-panel.tsx` connect existing behaviors to the shared owner/guard.
- `frontend/src/lib/{workspace-navigation,browser-navigation}.ts` implement leave
  policy/browser protection; `auth-session.ts`, `resources-state.ts` and
  `lessons-state.ts` handle disposal/pause and stale recovery eligibility.
- `frontend/test/workspace-navigation.test.mjs`, expanded authentication/resource/lesson
  state tests and `frontend/test/rendered/foundation.test.mjs` cover the changes.
- `frontend/package.json` exposes the optional `test:browser` command.
- Root and frontend READMEs link this guide and describe the routes/font setup.

## Preserved behavior and deviations

NestJS remains authoritative for roles, ownership, validation, versions and source
capture. API endpoints, exact request/response contracts, deadlines, CSRF,
credentialed/no-store transport and backend permissions are unchanged. No backend
or schema changes. Draft saves may remain incomplete; source actions save
separately and ordinary saves preserve snapshots. No automatic write retry,
version adoption or snapshot refresh is introduced.

Workspace identity includes user ID, role and absolute session expiry. Temporary
uncertainty retains text with actions paused. Confirmed logout/401, expiry or a
replacement user/role/session disposes the old workspace. Text never transfers to
a replacement session, including a new session for the same account.

Unlike the preview, navigation confirmation retains mounted session work rather
than discarding it. A full reload still loses unsaved memory. Existing resource
detail and lesson editors remain in their current panels. No preview fixture,
authentication provider, browser persistence, role/state selector, simulation or
future workflow is copied into application code. Test fixtures are isolated in
the rendered test harness and never shipped as application data.

## Recorded automated verification

This section records implementation-time checks. Request/state tests mock the
transport, and the rendered suite intercepts API responses. The counts below do
not establish real API/database browser integration or a visual/manual pass.
The independent review reused this evidence and ran only targeted checks; its
[results and limits](phase-1-review.md#review-checks) are separate.

Initial policy/state verification ran before enabling route navigation: 58 tests
passed. Before the WSL interruption, frontend type checking and all 88 request/
state tests passed. Lint/build completion was uncertain, and rendered tests had
not run. The final resumed verification includes the explicit-label correction,
read-eligibility corrections and mobile navigation styling:

| Check | Result |
| --- | --- |
| Frontend lint; focused lint of the final rendered test harness | Passed |
| `next typegen` and TypeScript | Passed |
| Frontend request/state tests | 90 passed, 0 failed |
| Default Turbopack production build | Environment blocked; see details below |
| Explicit Webpack production build, including TypeScript and static generation | Passed on original Phase 1 source |
| Rendered Chromium interaction suite against that original production build | 14 passed, 0 failed |
| `git diff --check` | Passed |

Rendered coverage includes teacher/admin navigation; dirty cancellation and
retention; Navigation API and indexed-history Back/Forward; pending/uncertain
write blocking; exact-result acknowledgement/version adoption; unknown-ID creation
inspection and failed reinspection; authentication pauses and late writes;
confirmed 401/logout/expiry disposal; independent user, role and session
replacement; sign-in validation/password clearing; keyboard focus and viewport
fit at 320/390/768/1024/1440px. The keyboard test checks the skip link and its focus
outline; it does not assert route-heading focus, the complete tab order, screen
reader output, or visual fidelity. No page runtime errors were observed in these
tests. Those original 14 history/interaction cases omitted fragment-created
entries and did not detect R1. Correction-specific results are recorded separately
in the [follow-up](phase-1-review.md#r1-correction-follow-up).

No dependencies or browser binaries will be installed. The rendered runner accepts
`PLAYWRIGHT_MODULE` for an already installed Playwright module, plus Playwright's
normal browser-path/library environment settings. It launches a production Next.js
test server at `http://localhost:3210` and intercepts every API request at
`http://localhost:3001`; it does not contact the development backend/database.

### R1 correction verification

The interrupted correction was resumed from its existing guard/provider changes
and 30 new rendered regressions. Its latest successful lint and Webpack build
(including TypeScript/static generation) were preserved and reused; no application
or test code changed after that build. Standalone TypeScript and all 90 request/
state tests passed again after resume. Four focused history regressions passed,
then the complete rendered suite passed **44 cases, 0 failed, 0 canceled**, with
no page runtime errors. These are automated fixture/intercepted-API results.

The [correction record](phase-1-review.md#r1-correction-follow-up) explains the
implementation, earlier failing candidates, test commands and fallback tradeoff:
blocking an unrecognized entry without a known history distance restores the
workspace by replacing that destination entry. Exact preservation of arbitrary
unmanaged history is not guaranteed. Managed Back/Forward and native-position
Navigation API rollback are covered by the rendered regressions. Documentation
links/anchors, new-file whitespace and `git diff --check` also passed.

The independent correction review subsequently passed all 30 history regressions
and eight additional browser scenarios for repeated unknown-entry traversal,
reachable recovery and native fragments/Skip during pending writes. It assessed
the fallback replacement as an acceptable documented history limitation and
resolved R1. These checks still use intercepted API responses. Full real
API/database draft and integration acceptance, visual/manual comparison, zoom,
assistive technology, other browser engines and deployment security checks remain
pending below; see the [review evidence](phase-1-review.md#independent-correction-verification).

### Commands and environment limits

From the repository root, select Node with `nvm use`, then:

```bash
npm run lint --prefix frontend
npm run typecheck --prefix frontend
npm test --prefix frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm run build --prefix frontend
```

These run lint, generate route types/check TypeScript, exercise request/state
contracts, and produce the default production build. The default Turbopack build
was attempted twice (including a permission retry) and failed because its CSS
worker could not bind a local port (`Operation not permitted`). A first restricted
Webpack attempt also failed to parse a TypeScript subprocess's `--showConfig`
output; standalone `tsc --showConfig` succeeded, and the Webpack permission retry
passed. No Next.js configuration or compiler dependency was changed to hide these
environment failures. The explicitly verified production fallback is:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm run build --prefix frontend -- --webpack
```

The browser command needs a completed production build with the API origin above.
It uses installed Playwright/Chromium, starts/stops its own frontend on port 3210,
and requires local socket/process permission. A restricted attempt could not
start the test server; the permitted run exercised the real rendered frontend.
The optional runner does not run automatically in the existing CI jobs.

No installation was performed: existing preview-tooling installations were used
through these environment variables (they are test tooling, not app dependencies):

```bash
PLAYWRIGHT_MODULE=/home/mariga/design-work/lessonforge-ui/node_modules/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/tmp/lessonforge-ui-browsers \
LD_LIBRARY_PATH=/tmp/lessonforge-ui-browser-libs/extracted/usr/lib/x86_64-linux-gnu \
npm run test:browser --prefix frontend
```

Those `/tmp` browser/library paths are environment-specific and may disappear.
If no usable Playwright installation exists, the developer can choose to run:

```bash
npm install --save-dev --prefix frontend playwright
npm exec --prefix frontend -- playwright install chromium
```

The first command adds the optional browser-test package and updates the npm
lockfile; the second downloads Chromium. If Linux libraries are missing,
`npm exec --prefix frontend -- playwright install-deps chromium` installs the
required OS libraries and may request administrator privileges. Run none of these
when the existing tooling is sufficient. With a local installation and its normal
browser cache, `npm run test:browser --prefix frontend` needs no path overrides.

## Real API/database browser evidence

Earlier user reports are historical evidence for the pre-Phase 1 application:

- The user reported teacher/administrator login, refresh restoration, logout and
  incorrect-password rejection on 2026-10-14, then separately reported API-outage
  recovery; see [authentication reports](../frontend-authentication-verification.md#developer-browser-results-on-2026-10-14).
- The user reported completion of the resource browser checklist on 2026-10-19;
  see [the resource report and its limits](../curriculum-resources.md#developer-browser-report-2026-10-19).
  This is the user's report, not an agent-performed check or a new per-item result.

No new Phase 1 real API/database browser pass was reported or performed in this
review. The [teacher draft browser checklist](../teacher-drafts.md#local-checks-and-browser-checklist)
and full design-integration acceptance checks remain pending. The focused rendered
tests cover selected draft interactions only; they do not complete either list.

## Historical visual and manual checklist

This section records the earlier checkpoint and deferral. Its pending local
acceptance/navigation statements are superseded by the user-reported closeout
at the top of this document: all eight combined local checks passed, including
the deferred Phase 1 navigation checks. Unperformed deployment/security,
assistive-technology and other-browser checks remain pending; database
inspection is not inferred. The original checklist below is retained as history.

The handoff and preview are design references. Preview screenshots or automated
checks do not establish visual fidelity, accessibility, or real persistence in the
integrated application. No Phase 1 visual/manual pass is claimed here.

By user decision, corrected manual Back/Forward checks are deferred until after
Phase 3. They remain pending, not passed. R1's independent automated verification
and resolution do not mean Phase 1 is fully manually verified. The remaining real
API/database, visual, accessibility and other-browser checks below remain pending;
the deferral does not record a pass for any of them.

Automated browser checks use Chromium with intercepted API responses, including
the history fallback with the Navigation API disabled. They establish rendered
interaction behavior, not Firefox/WebKit behavior, real cookies, HTTPS, database
durability or full assistive-technology compatibility. Backend checks were not
rerun because backend code/contracts and schema are unchanged; no development
database was contacted. Existing API contract/state tests remain the regression
coverage for version checks and retained snapshot behavior.

With the existing privately configured database and provisioned accounts, run
`npm run start:dev --prefix backend` and, in another terminal,
`NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm run dev --prefix frontend`.
These start the existing API and frontend; they do not reset, seed or migrate data.
Use `http://localhost:3000/sign-in`, matching the configured API/CORS hostnames.

1. Sign in as teacher and administrator separately. Check the role navigation,
   restoration, password visibility/clearing, error feedback and confirmed-only
   sign-out notice. Check reload with real cookies and no optimistic sign-out.
2. In My drafts, open/create a draft and enter unsaved text. Cancel navigation,
   then accept it and return: text remains in the same session. Corrected manual
   Back/Forward checks (including dirty, pending and uncertain writes, URL/workspace
   synchronization and reachable recovery) are deferred until after Phase 3 by
   user decision. Check reload warnings separately. Reload loses unsaved memory after a permitted
   departure; reopen a saved draft to confirm server persistence.
3. During a save, or with a lost response, attempt links, logout and discard:
   they must remain blocked. Load/compare the exact saved result, acknowledge
   explicitly and adopt its version only by choice. Confirm a failed subsequent
   read cannot unlock acknowledgement; no automatic write retry should occur.
4. While editing teacher/admin content, block API access or session checking.
   Text must remain with controls paused. Restore the same confirmed session:
   interrupted writes require reconciliation. Confirmed logout, a 401, real expiry
   or a new session must clear the previous editor, including for the same user.
5. Check keyboard-only use, error-summary links, skip link, route-heading focus,
   zoom and screen reader announcements. Check 320/390/768/1024/1440px widths in
   supported browsers. Full editor/save-bar redesign remains Phase 3.
6. Outside the restricted agent runtime, rerun the default Turbopack production
   build. On the intended HTTPS deployment, separately verify Secure/HttpOnly
   cookie flags, credentialed CORS, CSRF rejection, rate limits, expiry and
   cross-account isolation using the existing verification guides.

Do not share passwords, cookie values or unredacted network captures. No real
authentication/deployment security or production readiness is claimed by this work.

## Review state

At review, branch `feat/frontend-design-foundation` remains at the original staging
base `130dd79`, with the existing implementation unstaged and the index empty.
Documentation now lives under `docs/ui/`, including the independent review record.
Backend code, API contracts, Prisma/schema/migrations and npm lockfiles are
unchanged. Phases 2 and 3 remain unimplemented. Application code was not changed
during the independent review; the later authorized R1 correction changes only
the browser guard, its provider integration and rendered regressions. R1 is now
resolved by the subsequent independent correction review. That review changed UI
documentation only; the remaining real API/database and manual checks are still
pending.
