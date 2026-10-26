# Frontend design integration — Phases 1 and 2

This guide is in `docs/ui/`, the location for future frontend integration and
design documentation.

## Phase 2 — resource browsing and management (2026-10-26)

Preparation matched the request: branch `feat/frontend-design-resources`, clean
working tree and empty index, with the Phase 1 shell, persistent workspaces,
shared controls and independently corrected R1 navigation guard present. No
branch operation, fetch, repository cleanup, staging or commit was performed.
The Phase 1 record below is historical; its deferred manual checks remain pending.
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

## Outstanding visual and manual checks

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
