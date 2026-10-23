# Phase 1 pre-commit review

Reviewed on 2026-10-23. The actual branch is `feat/frontend-design-foundation`.
`HEAD`, the locally fetched `origin/staging` reference and their merge base are
`130dd79278ab2ab72e5417e2b1aa31e5cc6a33a6`. This review did not fetch or change Git
references. The index was empty; existing Phase 1 edits and untracked files were
included in the review. No application code was changed.

## Findings

### R1 — P1 blocker: fragment history bypasses the fallback navigation guard

**Status: resolved by the [independent correction verification](#independent-correction-verification)
on 2026-10-23.** The original finding at the pre-correction checkpoint is retained
below. The implementation follow-up alone did not close this finding; the later
review inspected the correction and independently verified its behavior.

Affected code at the original review checkpoint: [browser-navigation.ts](../../frontend/src/lib/browser-navigation.ts),
lines 23–28 and 63–75; the skip link is in
[application-shell.tsx](../../frontend/src/components/application-shell.tsx),
lines 60–62. The rendered navigation tests in
[foundation.test.mjs](../../frontend/test/rendered/foundation.test.mjs), starting
at line 295, cover ordinary route entries but not native fragment entries.

Trigger, reproduced against the existing production build with intercepted API
responses and `window.navigation` disabled to select the fallback:

1. Open `/resources` as a teacher. Focus **Skip to content** and press Enter.
   The URL becomes `/resources#main-content`; the browser creates an entry whose
   `history.state` is `null`.
2. Follow **My drafts**, open a draft, and enter unsaved text. Start a save with
   its response held, or finish it with a simulated 503 to leave it uncertain.
3. Use browser Back. The fallback returns early for the entry without its numeric
   marker. The URL becomes `/resources#main-content`, while the rendered heading
   and editor still show My drafts. There is no blocking notice or confirmation.
4. Click **Resources**. The capture handler considers it the same pathname as the
   current URL and skips `allow()`. Next.js switches the visible workspace to
   Resources, hiding the pending/uncertain draft.
5. With an uncertain save, **My drafts** is now blocked by the global registry.
   The user cannot reach the hidden reconciliation controls through navigation.

Impact: unresolved writes can leave their workspace, violating the Phase 1
navigation requirement, and uncertain recovery becomes inaccessible. The editor
remains mounted; this reproduction did not show automatic writes, discarded text,
or cross-session transfer. Ordinary unsaved work also changes workspace without a
confirmation through the same sequence.

Cause: native fragment navigation does not call the wrapped `pushState`, and a
missing marker does not necessarily mean a cross-document departure. The fallback
allows the browser URL and Next.js route to diverge. The subsequent same-path
shortcut then bypasses the protection callback.

Recommended correction: account for native fragment entries and their actual
history positions, preserve router/history synchronization, and fail closed for
same-document entries that are not understood. Alternatively, handle these
in-page anchors without creating unmanaged history entries while preserving
keyboard focus and scrolling. Ensure a URL mismatch cannot make route-changing
links bypass `allow()`. Add rendered fallback regressions for skip/editor anchors,
dirty confirmation/cancellation, pending/uncertain writes, Back/Forward and
multi-entry traversal; assert both URL and visible workspace remain consistent
and recovery stays reachable. Correct and verify this before commit.

### Non-blocking observations

No additional actionable application defect was identified in the reviewed diff.
Full Firefox/WebKit, visual comparison, zoom and assistive-technology checks remain
pending. The viewport assertions establish width fit for the exercised fixtures,
not a complete visual or accessibility assessment. The optional rendered runner
is not included in current CI and depends on separately available Playwright and
browser binaries, as already documented in the integration guide.

## Review coverage

Read `AGENTS.md`, the approved external `DESIGN_HANDOFF.md`, project specification,
architecture, roadmap, branching strategy, authentication/resource/draft contracts,
relevant backend controllers/input validation, and the entire tracked Phase 1
diff plus every untracked Phase 1 source/test/documentation file. Review included
the persistent layout/routes, shared controls/styles, auth expiry/disposal,
generation checks, both workspace stores, reconciliation and rendered fixtures.

The API helpers, backend, permissions, deadline transport, schema/migrations and
lockfiles have no Phase 1 diff. Source tracing and targeted tests support the
administrator pause/invalidation changes, retained ordinary session work,
operation-specific uncertainty and explicit version adoption. User/role/expiry
remain the workspace key; confirmed session end clears identity, and old results
cannot revive disposed stores. No preview fixtures, mock auth, browser persistence,
role selectors, or future submission/review/library/AI controls were found in
application source. Fixtures remain confined to tests. These findings do not
substitute for the outstanding real API/browser integration checks.

## Review checks

Reused the [recorded implementation verification](frontend-design-integration.md#recorded-automated-verification):
lint, TypeScript, 90 request/state tests, 14 rendered Chromium cases and the
Webpack production build. These are prior results, not checks rerun wholesale
during this review. Default Turbopack remains environment-blocked in that record.

New targeted checks:

- Nine selected Node tests passed: session end/expiry during cookie changes,
  administrator pause/late reads/writes/disposal, revoked reconciliation eligibility,
  stale creation candidates and navigation registry policy. They use mocked APIs.
- Four focused rendered scenarios reused the existing production build and test
  fixture setup: fallback with a pending save reproduced R1; fallback with an
  uncertain save reproduced R1 and blocked return to recovery; fallback with only
  dirty text bypassed confirmation; the Navigation API pending-save control kept
  `/drafts` and its editor visible with the expected blocking notice.
- These exploratory checks were executed in memory using the existing harness
  helpers. They are reproduction evidence, not new committed regression tests.
  Every API call was intercepted; no development backend/database was contacted.
- Restricted local-server startup and Chromium launch initially failed with
  `EPERM`; permitted retries completed the reproduction. An initial in-memory
  module-loading attempt also failed before running a browser check. These setup
  failures are not counted as passing tests. No installation was performed.
- Affected relative Markdown links/anchors, the `docs/ui/` index, absence of the
  old integration-document path, and `git diff --check` were verified after edits.

The selected source tests can be rerun from the repository root with installed
Node 24, without launching an API or connecting to a database:

```bash
node --test --test-isolation=none --test-name-pattern='authentication pause|failed ordinary list|failed list read|session expiry during|confirmed session end|navigation reads|another mounted workspace' frontend/test/auth-session.test.mjs frontend/test/resources-state.test.mjs frontend/test/lessons-state.test.mjs frontend/test/workspace-navigation.test.mjs
```

## Evidence boundaries and pending acceptance

The [integration guide](frontend-design-integration.md#real-apidatabase-browser-evidence)
separates earlier user-reported real browser outcomes from mocked/rendered tests.
The user's historical authentication and resource reports were not independently
repeated or expanded into individual results in this review. No new Phase 1
real-account/API/database or visual/manual pass was reported or performed.

The complete teacher draft browser checklist, all-field persistence/source
workflows, full integration acceptance, real cookie/CORS/CSRF/HTTPS behavior,
cross-browser behavior, zoom, screen readers and visual fidelity remain pending.
Phases 2 and 3 remain deferred. R1's correction and regression coverage have now
been independently verified as described below. This closes R1; it does not
complete the outstanding real API/database or manual acceptance lists.

## Documentation changes and Git state

This review updates this record, the UI index and the integration guide only.
The guide now distinguishes recorded automated evidence, historical user reports
and pending visual/manual evidence, narrows keyboard-test claims to actual
assertions, and records the open blocker. Existing application changes remain
unstaged; the index remains empty. No install, stage, commit, push or merge was
performed.

## R1 correction follow-up

This is an implementation follow-up on the same branch/base, not an independent
review sign-off. It leaves authentication, workspace stores, API helpers,
permissions, deadlines, version checks and explicit reconciliation unchanged.

### Correction and tradeoff

- [browser-navigation.ts](../../frontend/src/lib/browser-navigation.ts) retains
  the last committed URL/router state and observes entries created by its wrapped
  history methods. A marker is accepted only within the current observed chain
  and for its recorded complete URL. Missing/equal/foreign markers do not skip the
  live leave policy.
- Skip/error/editor anchors with a visible target in the committed document now
  create managed fragment entries, scroll to the target and move keyboard focus.
  Non-focusable headings receive a temporary `tabindex=-1`, removed on blur.
  Ordinary navigation links always run the leave policy, including same-path links.
- For known fallback entries, a denied traversal rolls back to the previous entry
  and suppresses intermediate router handling. Links cannot act during rollback.
  For an unrecognized entry, the guard restores the safe URL and Next.js state in
  place and invalidates old position assumptions. This keeps recovery visible
  without guessing a `history.go()` distance.
- A denied unrecognized fallback traversal therefore **replaces that destination
  history entry** with the current workspace. It cannot guarantee preservation of
  the exact arbitrary prior history stack. Managed Back/Forward entries retain
  normal traversal; this conservative behavior is specific to unrecognized entries.
- Permitted unmarked traversals are repaired through `router.replace()`, so a URL
  change cannot leave the old route heading rendered. This repair also runs with
  the Navigation API. That path checks the policy before traversal and captures
  actual native entry positions; a denied same-document traversal suspends router
  handling in `popstate` and rolls back by the native distance. It does not rely
  on markers for that distance or prompt twice for one traversal.
- The editor-anchor regression exposed a further Chromium behavior: after
  canceling a fragment Forward with `navigate.preventDefault()`, a subsequent
  Forward request emitted no traversal despite the forward entry still being
  present. The final same-document Navigation API path uses the rollback above rather
  than that cancellation mechanism. Cross-document/unload protection remains
  subject to the browser's existing cancellation/dialog policies.
- [workspace-navigation.tsx](../../frontend/src/components/workspace-navigation.tsx)
  supplies the committed pathname and Next.js replacement callback and synchronizes
  the safe entry after route commits. No editor/authentication content is stored
  in history; the added metadata describes navigation positions only.

### Regression coverage

The [rendered suite](../../frontend/test/rendered/foundation.test.mjs) adds a
24-case matrix: Navigation API/fallback × managed fragment/unmarked entry ×
Back/Forward (including multi-entry Forward) × dirty/pending/uncertain work.
Each case checks the URL, visible route heading, retained editor text and reachable
reconciliation controls, then clicks navigation after the blocked traversal.
Dirty cancellation and accepted departure, save completion, explicit uncertainty
acknowledgement/version adoption, and subsequent normal link/Back/Forward behavior
are asserted. A successful reconciliation read alone must still block leaving.

Four further cases accept dirty Back/Forward traversal to unmarked entries and
assert the real route heading changes while mounted text remains available on
return. Two editor-anchor cases assert keyboard focus and canceled/accepted
fragment Back/Forward. The original 14 interaction cases remain, including session
replacement, expiry, late writes, administrator pause, sign-in and responsive fit.

### Verification status

Before changing the guard, the new fallback/fragment/Back/pending regression ran
against the prior production build and failed waiting for the missing navigation
notice, reproducing R1. This was an intercepted-API browser reproduction, not a
real API/database test. The final correction checks and limits are recorded below
separately from the original review. Independent review was pending at this
implementation handoff and was subsequently completed below.

The implementation interruption occurred after the final guard adjustment,
production build and lint had completed, before the final focused/browser checks
had confirmed results. On resume, `AGENTS.md`, branch/status, tracked diff,
untracked correction files and these records were inspected. The code and 30 new
regressions were preserved. The latest completed production build is newer than
the guard/provider source, and no application/test code was changed during resume.

| Correction check | Actual result |
| --- | --- |
| Webpack production build, including TypeScript and eight-page static generation | Passed before interruption on the final guard; reused |
| Frontend lint | Passed before interruption on the final source; reused |
| `npm run typecheck --prefix frontend` | Passed again after resume |
| `npm test --prefix frontend` | 90 passed, 0 failed after resume |
| Focused R1 pending Back, unmarked uncertain Forward, and both editor-anchor variants | 4 passed, 0 failed after resume |
| Full rendered Chromium suite against the final production build | 44 passed, 0 failed, 0 canceled after resume; includes all 30 new regressions and original 14 cases |
| Documentation links/anchors, new-file whitespace and `git diff --check` | Passed after the final documentation edits |

The full rendered run exited 0 with no page runtime errors. At this implementation
handoff, the correction and its automated verification were complete, with R1
**awaiting independent reviewer verification**. The subsequent review below,
rather than these implementation-agent results, resolves R1.

An earlier correction candidate passed 29 of the 30 new rendered cases, but its
Navigation API editor-anchor case timed out. A bounded dialog wait and diagnostic
entry inspection established the canceled fragment Forward behavior described
above; timing-only test changes did not correct it. The guard was adjusted to use
native-position rollback, diagnostic logs were removed, and the rebuilt final
guard passed both focused anchor variants after resume. An interim build was
stopped while the guard was still being adjusted; it is not counted as passing
evidence. The interrupted final test command had no confirmed result and was rerun.

All rendered checks use intercepted API responses and existing installed
Playwright/Chromium. They launch their own local frontend on port 3210 with local
process/socket permission. No dependencies or browser binaries were installed,
and no development API/database or real browser account was used. The earlier
default Turbopack environment block is retained; the correction requests and
verifies the explicit Webpack build only.

Independent reviewer verification of R1 was pending at that handoff and is now
recorded below. Real API/database draft and full integration checks, Firefox/WebKit,
visual/manual comparison, zoom, screen readers and deployed cookie/CORS/CSRF/HTTPS
checks remain pending. Historical user reports above retain their original scope;
no new manual passes are inferred from this correction. Phases 2 and 3 remain
unimplemented.

To select the 30 history regressions, use the existing browser/module environment
settings from the [integration guide](frontend-design-integration.md#commands-and-environment-limits)
and run this from `frontend/` after a production build:

```bash
node --test --test-isolation=none --test-concurrency=1 --test-name-pattern='fragment history' test/rendered/foundation.test.mjs
```

The final focused rerun selected the original fallback pending Back reproduction,
fallback unmarked uncertain Forward, and both editor-anchor variants; the full
`npm run test:browser --prefix frontend` run then exercised every case. The
request/state tests and standalone TypeScript checks were rerun because their
interrupted command had no confirmed completion. The final lint and Webpack
results were reused because the correction source was unchanged after those
successful commands. No broad application check remains interrupted or uncertain.

At completion, `HEAD` remains `130dd79` on `feat/frontend-design-foundation`.
There are 16 modified tracked files and 14 untracked files, all unstaged, including
the preserved Phase 1 implementation and UI records. The index is empty. Backend,
schema/migrations and lockfiles are unchanged; no stage, commit, push or merge was
performed.

## Independent correction verification

Reviewed on 2026-10-23, separately from the implementation follow-up. **R1 is
resolved. No blocking or actionable application defect was found in the navigation
correction.** The original Resources → Skip to content → edit draft → held save →
Back → Resources sequence stayed on the draft, with URL, visible route heading,
editor content and recovery controls synchronized, on both navigation paths.

### Source and regression assessment

The actual branch remained `feat/frontend-design-foundation` at `130dd79`, with
an empty index. Read `AGENTS.md`, this record, the integration guide and relevant
workspace/reconciliation contracts. Inspected the actual tracked diff and
untracked source/tests, including the browser guard, provider, persistent shell,
route pages, controls and navigation tests. Existing frontend source/test hashes
and tracked changes were recorded before documentation edits and compared again
afterward; application/test files were preserved unchanged.

The correction removes the same-path link escape at
[browser-navigation.ts](../../frontend/src/lib/browser-navigation.ts), lines
72–108: the exemption requires a real visible in-document anchor, the committed
URL and rendered route; workspace links still consult the leave policy. Lines
167–213 gate traversals and repair permitted unmarked destinations through Next.js.
The provider's committed-route synchronization is in
[workspace-navigation.tsx](../../frontend/src/components/workspace-navigation.tsx),
lines 31–40 and 57–74. The review found no change to authentication isolation,
API helpers, permissions, deadlines, version adoption or store reconciliation.

The 30 history cases in
[foundation.test.mjs](../../frontend/test/rendered/foundation.test.mjs), lines
344–555, assert URL, visible heading/workspace, retained editor text, reachable
reconciliation controls, dirty cancellation/acceptance, blocked links after a
history attempt, and normal link/Back/Forward behavior after save or explicit
reconciliation. They verify one write rather than automatic retries. The four
accepted-unmarked cases assert the actual destination heading, catching a URL-only
repair that leaves the old route rendered. Keyboard Skip and editor-anchor focus
are asserted. These are meaningful interaction assertions, not just marker checks.

A non-blocking coverage opportunity remains: the committed matrix primarily
cancels one history transition per fixture. Repeated traversal after an unknown
entry has been replaced, native `location.hash` insertion outside anchor handling,
and Skip during a pending save are not retained as dedicated repository tests.
This review independently exercised those cases below. Keeping those scenarios
as future regression tests would strengthen coverage; they exposed no defect in
the current correction and do not block R1 closure.

### New independently executed checks

| Review check | Actual result |
| --- | --- |
| Checked-in `fragment history` rendered subset | 30 passed, 0 failed, 0 canceled |
| Additional temporary browser checks | 8 passed, 0 failed, 0 canceled |
| Documentation links/anchors, new-file whitespace and `git diff --check` | Passed after review edits |
| Application/test preservation and empty index | Verified after review edits |

The 30-case command used the already documented Playwright/browser/library
environment and existing Webpack production build; no dependencies were installed.
The additional checks used a temporary module at
`/tmp/lessonforge-r1-review-vz3KnE/independent-history.test.mjs`, with existing harness
fixtures/server lifecycle but independently written scenarios and assertions.
It is review evidence, not an addition to the repository's test suite:

- Six cases cover Navigation API/fallback × dirty/pending/uncertain work. They
  create an unmarked fragment entry, exercise repeated Back/Forward or multi-entry
  traversal, click Resources after blocking, and assert both title and introduction
  text survive with the draft heading and reconciliation controls visible.
- A pre-hydration capture listener counts actual `popstate` attempts before
  assertions, avoiding a check that could pass before traversal occurs. Browser
  history was inspected with Chromium's read-only `Page.getNavigationHistory`.
- The uncertain cases force a failed reconciliation, verify acknowledgement stays
  unavailable, then read successfully, verify navigation still blocks until
  explicit acknowledgement/adoption, and resume normal navigation. Each case
  verifies exactly one deliberate content PUT and its retained title/introduction
  payload, plus subsequent clean Back/Forward and editor restoration.
- Two cases insert a native `location.hash` entry during a held save, confirm it
  cannot hide the editor, then keyboard-activate Skip to content while the save is
  still pending. Focus reaches `main-content`; text/recovery remain available,
  Resources stays blocked, and navigation resumes after the held save completes.

All review browser checks intercept API responses. No page runtime errors were
observed. No real API/database, passwords or development accounts were used.
The previous 44-case full rendered run, 90 request/state tests, lint, standalone
TypeScript and Webpack build were reused as recorded evidence rather than rerun
wholesale. The existing build postdates the unchanged correction source. Default
Turbopack remains separately environment-blocked/unverified for this correction.

### Unknown-entry tradeoff verdict

The fallback at [browser-navigation.ts](../../frontend/src/lib/browser-navigation.ts),
lines 153–165 and 187–195, intentionally replaces an unknown destination entry
when it cannot know a safe rollback distance. The history inspection confirmed
this: the blocked fallback Back moved from current index 3 to index 2, whose URL
was replaced with the retained draft URL. The Navigation API cases rolled back to
index 3 without replacing that destination. These indices are observations from
this test history, not assumptions required by the guard.

**Acceptable documented history limitation:** repeated fallback blocking can leave
duplicate draft entries and consume earlier destinations. It does not discard
editor data or alter API/store state; histories do not own the mounted editor.
Source inspection and the repeated-traversal checks found no unsafe workspace
departure, extra write, lost title/introduction, or inaccessible recovery. Once
the save/reconciliation completed, ordinary navigation and clean Back/Forward
worked. Exact arbitrary history preservation is not promised, and the limitation
must remain documented. A reload or permitted cross-document departure can still
lose unsaved in-memory content under the existing browser unload policy.

### Limits and review state

R1 is independently verified within the production frontend's Chromium rendered
fixture scope. Real API/database draft persistence and full integration acceptance,
Firefox/WebKit, manual visual comparison, zoom, screen readers, real cookies,
CORS/CSRF and HTTPS deployment checks remain pending. The older user-reported
manual results are unchanged and are not expanded by these automated checks.

For commit preparation, the user decided to defer corrected manual Back/Forward
checks until after Phase 3. This includes dirty, pending and uncertain writes,
URL/router/visible-workspace synchronization, reachable recovery and resumed
navigation after save/reconciliation. These manual checks remain pending, not
passed. R1 remains independently verified and resolved on the automated evidence
above; Phase 1 is not fully manually verified. The documented fallback history
limitation remains accepted, and all other outstanding real API/database, visual,
accessibility and other-browser checks remain pending.

Only `docs/ui/` records were edited in this review. Branch/base, the 16 modified
tracked files and 14 untracked files remain as inspected; all changes are unstaged
and the index is empty. No install, stage, commit, push or merge occurred.
