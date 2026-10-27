# Phase 3 independent pre-commit review

Reviewed on 2026-10-27 on `feat/frontend-design-drafts`. The actual base is
`fe02f6491b76881039f107dfbd4c1f809010cd17`: `HEAD`, local `staging`,
`origin/staging`, and both merge bases match. Phase 1 `e6412cc` is an ancestor.
No fetch or branch operation was performed. At review entry there were four
modified tracked files, an empty index and no untracked files. The complete
unstaged diff against that base was reviewed, including all application, test
and documentation changes. No application or repository test file was edited.

## Correction status — 2026-10-27

R1, D1 and D2 are **corrected, with automated tests passed and user manual
acceptance passed**. Independent re-verification of the corrections was **skipped
by user decision**; it was not performed and is not represented as independently
resolved. The correction follow-up is recorded in the
[integration record](frontend-design-integration.md#r1-d1-d2-correction-follow-up-2026-10-27).
The original findings, reproductions and review evidence below remain historical
review context; their line numbers refer to the implementation reviewed before
these corrections. Implementation checks do not independently resolve findings.

The user reports **all eight combined manual acceptance checks from this
conversation passed**, including the previously deferred **Phase 1 navigation
checks**. Attribute all eight passes to **user-performed local acceptance**, not
Codex execution. The navigation checks are part of those eight, not additional
checks. See the [local acceptance closeout](frontend-design-integration.md#user-reported-local-acceptance-closeout).
No database inspection, HTTPS/deployment or security verification, screen-reader
or other assistive-technology testing, or Firefox/WebKit coverage is inferred.
Unperformed deployment/security, assistive-technology and other-browser checks
remain pending.

The implementation follow-up passed frontend lint, standard repository TypeScript,
97 request/state tests, 74 complete rendered tests and the Webpack build. It added
five state and 13 rendered cases, including native-invalid versus unset timings,
all requested initial/scrolled viewport checks, and paused/stale return-list reads.
These are mocked/intercepted-API checks. See the integration record for exploratory
failures, corrected assertions, evidence locations and the separate user-reported
local acceptance. No application checks were rerun for this documentation-only
closeout.

## Findings, ordered by severity

### R1 — P2 functional correction: a removed activity's timing error moves to another activity

**Original review: open before approval. Closeout: corrected; automated tests and
user manual acceptance passed. Independent re-verification skipped by user decision.** Relevant code:
[LessonMinutes](../../frontend/src/components/lessons-panel.tsx), lines 64–81,
and the activity `key={index}` at line 592.

Reproduced against the existing production build with intercepted API responses:

1. Open a draft containing two activities with durations 1 and 5.
2. Change Activity 1's duration to 1441. Its native range validation, associated
   alert and `aria-invalid` correctly indicate an error.
3. Remove Activity 1. The remaining activity displays 5 and its native
   `validity.valid` is `true`, but still has `aria-invalid="true"` and the alert
   **Value must be less than or equal to 1440.**
4. Save the now-valid draft. The request sends duration 5 and succeeds; the
   false error remains after the confirmed save.

`LessonMinutes` retains its own error string. React reuses the first activity's
component because activities use positional keys, so the error survives a change
in which activity occupies that position. This local error state is new in Phase
3; the positional keys were already present in the base.

Impact: valid content is announced as invalid, including alongside a successful
save. This is a validation/accessibility regression, not a demonstrated data-loss,
authorization, snapshot or unresolved-write bypass. No P1 security or recovery
blocker was found, but this P2 needs correction before approval.

Recommended correction: keep error presentation associated with the current
field/activity identity and validity. Use stable local activity identities or
reset/recompute stale validation feedback when a field's value/identity changes,
without changing API payloads or backend validation. Add a regression that removes
an invalid earlier row and checks the remaining valid row and successful save
have no obsolete alert/`aria-invalid` state.

## Design-acceptance gaps

These are separate from R1 and from the pending live/manual acceptance checks.

### D1 — P3: normal editor instructions/recovery bury the editable content

Location: [lessons-panel.tsx](../../frontend/src/components/lessons-panel.tsx),
lines 261–282, 360–367 and 423–507, particularly the unconditional recovery
section at line 432.

Trigger: open a clean saved draft normally, without manually scrolling to a field.
The editor shows extensive repeated instructions, the draft ID, aggregate limits
and a fully expanded comparison/recovery panel before its writing/snapshot grid.
At 1440×900 the title textarea starts at viewport Y≈1063; at 320×900, after the
normal heading-focus transition, it starts at Y≈1791. Save is visible in both
cases. New independent viewport screenshots confirm that the first screen does
not show editable lesson content. The list prompt **Create a draft or open one
of your saved drafts** also remains visible while a draft is already open.

The reference presents writing prominently and expands recovery when needed.
The integration record deliberately retains always-available comparison controls,
but production contracts do not require a fully expanded idle recovery panel or
duplicated instructions. This is a design gap; it is not evidence that recovery
is inaccessible or that sticky Save/overflow checks failed.

Recommended correction: make the normal editor more compact, condition the list
prompt on the list view, and place optional instructions/comparison behind a
native disclosure or equivalent. Automatically expose and keep recovery reachable
for conflicts, uncertainty and failed inspections. Preserve all store gates and
never turn a read/disclosure into a write or version adoption. Verify normal
open/create views before manually scrolling, as well as scrolled Save visibility.

### D2 — P3: returning from a confirmed create shows a stale draft list until Reload

Location: [lessons-panel.tsx](../../frontend/src/components/lessons-panel.tsx),
lines 289–308 and 346–350; unchanged
[lesson state](../../frontend/src/lib/lessons-state.ts), `save` and `close`.

Trigger: create/save a draft whose server ID differs from existing list entries,
then close the clean editor. The new draft is absent from the returned list.
**Reload drafts** fetches it, after which opening its exact ID works. Renamed
existing summaries can likewise remain stale. The read/store behavior predates
Phase 3; the new local list/editor presentation exposes it in the normal return
flow. No persistence loss or duplicate write was observed.

The reference reloads its list on return. The production implementation's manual
Reload workaround is available but this deviation was not called out in the
handoff adaptation list. It can make a successful save appear missing.

Recommended correction: refresh the authenticated list on a confirmed return, or
update appropriate summary data only from confirmed server results while keeping
server pagination authoritative. Retain separate content/source mutations and all
write preconditions. Test a distinct server-assigned creation ID and reopening
from the returned list without a manual Reload step.

## Scope, reference and contract review

Read `AGENTS.md`, the draft contracts/verification guide, relevant resource and
authentication contracts, the UI integration record, and the prior Phase 1/2
review context. The recovered reference was read at the exact recorded location:
`/home/mariga/design-work/lessonforge-ui/DESIGN_HANDOFF.md` (approved 2026-10-23),
with its draft workspace, field and style sources. No wrong-directory inference
or reconstructed handoff was used.

The diff changes only `frontend/src/components/lessons-panel.tsx`, the rendered
harness and two UI documentation files. API helpers, lesson/resource stores,
authentication providers/transport, navigation guard, backend/controllers/input
validation, schema/migrations, dependencies and lockfiles are unchanged.

Source review supports these preserved contracts:

- Teacher identity/ownership and editable lifecycle remain server-owned. Requests
  contain only content or the expected lesson version/resource route target.
- Content saves and select/remove/explicit Refresh remain separate. Sources are
  server-returned snapshots; ordinary saves do not capture/refresh them. Existing
  retired snapshots remain readable/removable, and backend selection/refresh
  rules remain authoritative.
- Exact-target API response validation, store generations and explicit
  reconciliation gates remain intact. Failed/new reads revoke acknowledgement
  eligibility. Candidate inspection, acknowledgement, no-match handling and
  identity/version/selection adoption remain separate deliberate actions.
- Temporary auth uncertainty disables and pauses the last workspace, invalidates
  in-flight responses and turns interrupted writes uncertain. Confirmed logout,
  401/expiry or user/role/session-expiry replacement disposes it. The unchanged
  providers and keyed shell preserve this isolation.
- Navigation reads current store state, retains dirty work on permitted route
  departures, and blocks pending/uncertain writes. Routes do not encode draft
  selection. Recovery remains in the visible draft workspace; fragment anchors
  and source-heading scroll margin retain the existing guard integration.

Approved presentation now includes neutral cards, native labeled controls,
associated hints/errors, a top-sticky Save/status bar, local view/error focus,
and stacked writing/snapshots changing to two columns at `xl`. Heading ranks were
independently asserted as a stable page `h1`, local editor `h2`, section `h3`s and
snapshot/available-resource `h4`s, without a skipped level in the exercised view.

Documented adaptations for exact arrays and multiline titles, optional numeric
values, the stable page heading, explicit production recovery labels, server UUIDs
and pagination are reasonable. Preview storage keys, simulated sessions/writes,
client-owned metadata, local creation/no-write shortcuts and generic departure
from uncertain work must remain excluded. D1/D2 are additional presentation
tradeoffs requiring correction or explicit design acceptance, rather than backend
contract requirements.

## Test assessment and evidence boundaries

The new rendered tests meaningfully inspect outgoing create/save/source bodies,
version preconditions, exact multiline/whitespace array entries, zero/blank timing,
optional field omission, labels/native validation, focus, column changes, and
scrolled Save/overflow at the required widths. Their assertions exercise the
actual production UI, API helper and store with intercepted responses.

Coverage limitations found during this review:

- No submitted regression removes an earlier invalid activity and checks the
  local validation message on the remaining row; R1 was missed.
- The creation fixture at `foundation.test.mjs:277` reuses its existing lesson ID.
  The new save/reopen test explicitly clicks Reload at line 1668. It therefore
  does not establish a fresh-ID creation appearing in the normal returned list.
- The snapshot fixture implements a single-source catalog and replaces its source
  array with one selection. It does not independently verify five-resource or
  multi-source backend capture rules, retirement, or database concurrency.
- The viewport case manually scrolls the title into view and positions source
  cards before capture. These are meaningful scrolled geometry checks, but do not
  establish normal initial editor composition; D1 was missed.
- Overall UTF-8 budget, NUL rejection, authorization and transactional persistence
  remain backend/source and earlier test evidence, not newly exercised live
  browser/database behavior. Existing state tests assert failed/wrong/stale
  inspection, explicit adoption/no-match and late-response rejection; those
  unchanged tests/results were inspected/reused, not rerun in this review.

The implementation's current-source lint, standard repository TypeScript,
Webpack build and 15 affected Chromium cases are reused. The earlier 92-case
request/state suite and unaffected Phase 1/2 evidence are also reused. The
59-case complete rendered result predates the final design alignment and is not
represented as a fresh full-suite pass. None of these passes resolves R1.

## Independent checks actually run

Five temporary Chromium probes completed with 0 harness failures. Two intentionally
asserted reproduced/current behavior (R1 and D2); their passing test status is not
a passing product-acceptance result. A third measured D1 while checking heading
structure. The remaining probes asserted array/reload semantics and list feedback.

| New review check | Actual result |
| --- | --- |
| Branch/base/index and complete tracked/untracked diff | Expected branch, base `fe02f64`, empty index; four tracked changes and no untracked files at entry |
| Activity deletion/validation reproduction | R1 reproduced: native-valid 5, `aria-invalid=true`, stale range alert, still present after confirmed save |
| Array boundaries / exact values / reload | Passed: 30-entry caps, native 1000/500 limits, embedded LF/whitespace, blank entry versus explicit `[]`, page reload followed by explicit reopen |
| List loading/empty/read failure | Passed with a held list read, empty response, 503 and explicit recovery; empty feedback suppressed during loading/error |
| Distinct creation ID / return-to-list | D2 reproduced; explicit Reload exposes the saved record, exact-ID reopen works, one POST |
| Heading outline / clean initial viewport | Outline passed at 320/1440px; field positions and two independently inspected screenshots evidence D1 |
| Application/test preservation | Before/after SHA-256 manifests match for all 35 frontend source/test files |
| Documentation links and `git diff --check` | Passed after review documentation updates |

The temporary runner copied the fixture/helper portion of the repository harness,
pointed its root at the actual frontend build, and added only review fixtures for
held/empty/failed list reads and distinct creation IDs. It started/stopped its own
Next production server on port 3210 and reused installed Playwright/Chromium and
library overrides. No dependency/browser installation or application build was
performed in this review; local process/socket permission was reused. Every API
request was intercepted. No real API/database was started or contacted.

Evidence directory: `/tmp/lessonforge-phase3-independent-review-r8skcxct`.
It contains `phase3.diff`, the source hash manifest, original harness copy,
`review-probes.test.mjs`, and `clean-editor-320.png` / `clean-editor-1440.png`.

Executed probe command from repository root:

```bash
PLAYWRIGHT_MODULE=/home/mariga/design-work/lessonforge-ui/node_modules/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/tmp/lessonforge-ui-browsers \
LD_LIBRARY_PATH=/tmp/lessonforge-ui-browser-libs/extracted/usr/lib/x86_64-linux-gnu \
node --test --test-isolation=none --test-concurrency=1 \
  /tmp/lessonforge-phase3-independent-review-r8skcxct/review-probes.test.mjs
```

## Acceptance closeout and remaining checks

At the original review checkpoint R1 was open and D1/D2 were design gaps. All
three were corrected, automated tests passed, and the user reports manual
acceptance passed within all eight combined local checks. The previously deferred
Phase 1 navigation checks are now recorded as passed by the user. Independent
re-verification of the corrections was skipped by user decision, not completed.

Keep unperformed deployment/security, assistive-technology and other-browser
checks pending. The local report does not establish database inspection,
HTTPS/cookie/CORS/CSRF/security verification, screen-reader testing or
Firefox/WebKit coverage. No production/deployment readiness is claimed. This
closeout changes documentation only and preserves existing application/test work.

Only this new review record, the integration record and UI index were changed
during review. Existing application/test edits are preserved. All work remains
unstaged on `feat/frontend-design-drafts`, with an empty index. No branch change,
cleanup, install, database change, stage, commit, push or merge was performed.
