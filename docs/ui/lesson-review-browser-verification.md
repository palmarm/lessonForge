# Lesson review rendered verification — 2026-10-30

Latest C1 correction result: **99 passed, 0 failed, 0 skipped/cancelled**, plus
**20 focused rendered passes**, 135 request/state passes, lint, standard TypeScript
and a matching production build. C1 is **independently verified and resolved**;
R1 remains fixed. The earlier independent review found C1 on the
previous 91-case source; its findings/evidence remain historical. See the
[independent C1 verdict and execution limits](lesson-review-independent-review.md#c1-independent-verification--2026-10-30)
and [fresh C1 correction evidence](#c1-shared-guidance-focus-correction--2026-10-30).
Live API/database and manual acceptance remain pending.

Initial run result: **91 tests executed, 84 passed, 7 failed, 0 skipped,
0 cancelled, 0 todo**. The complete existing suite ran once, sequentially;
exit status 1, duration 425,851 ms (about 7 minutes 6 seconds). No application
or test code/assertions were changed. The failures remain open for review.
This supersedes earlier statements that Chromium prevented any rendered run;
it does not establish full rendered acceptance.

## Source and build provenance

Read `AGENTS.md` and [the implementation record](lesson-review.md). Branch stayed
`feat/frontend-lesson-review`, HEAD `2b96627`. Existing tracked/untracked work
was preserved; the index remained empty. No branch operations or cleanup ran.

The recorded successful production build at
`/tmp/lessonforge-review-gu3f1zc6/frontend` predates changes to
`src/components/lesson-review-panel.tsx` and `src/lib/lesson-review-state.ts`.
The R1 verification copy has no production `BUILD_ID`. The workspace build's
`BUILD_ID` timestamp is October 27, before the October 29 state correction;
comparing workspace sources with themselves cannot establish build freshness.
Therefore a fresh production build was required.

Created `/tmp/lessonforge-browser-20261030-tz26v82a/frontend` by copying current
frontend sources, excluding `.env*`, `.next`, `node_modules` and `*.tsbuildinfo`,
then linking its `node_modules` to the already installed frontend dependencies.
No real environment files were read. No packages or browsers were installed.
All 56 application, public, test and configuration/manifest files matched the
copy before building, before browser tests and after the run. The manifest
contains sorted relative `path SHA256` rows with final newlines; its digest is
`fb4a9b68daf272207d54b7811476aaf625cde21217ef9847c857a0fa64b0bc13`.
This includes public assets in addition to the earlier 51-file manifest.

Actual command, from that isolated frontend directory:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 CIRCLE_NODE_TOTAL=2 NODE_OPTIONS=--max-old-space-size=512 NEXT_TELEMETRY_DISABLED=1 npm run build -- --webpack > ../build.log 2>&1
```

Build **passed, exit 0**: Webpack compilation (82 seconds), TypeScript
(31.8 seconds), page collection and generation using **1 worker**, ten pages,
optimization and build traces. Build ID: `CzOQaGg4T69BJdnxoAw-v`.
The process used the previously successful permitted subprocess execution and
512 MiB per-process Node heap ceiling; no configuration files were changed.
Browser tests started only after the build completed.

## Browser command and runtime

Confirmed `package.json` defines `test:browser` as:

```text
node --test --test-isolation=none --test-concurrency=1 test/rendered/*.test.mjs
```

The harness launches one Chromium browser and creates/closes fixture contexts
sequentially. It starts its own production Next.js server on localhost:3210 and
closes that server afterward. Listener inspection found ports 3000 and 3210 free
before building, immediately before testing and after completion. No duplicate
server was started and no unrelated process was stopped.

Used the already downloaded Playwright 1.64.1 / Chromium 156.0.8078.4 (revision
1248) and user-local extracted runtime. Prior setup receipts record successful
dependency checks and headless launch/close; this run additionally launched the
browser successfully for the actual suite. Actual command, same isolated cwd:

```bash
PLAYWRIGHT_MODULE=/home/mariga/design-work/lessonforge-ui/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/home/mariga/.cache/lessonforge-browser-runtime/browsers LD_LIBRARY_PATH=/home/mariga/.cache/lessonforge-browser-runtime/root/usr/lib/x86_64-linux-gnu ALSA_CONFIG_DIR=/home/mariga/.cache/lessonforge-browser-runtime/root/usr/share/alsa ALSA_CONFIG_PATH=/home/mariga/.cache/lessonforge-browser-runtime/root/usr/share/alsa/alsa.conf NEXT_TELEMETRY_DISABLED=1 npm run test:browser > ../browser.log 2>&1
```

The run emitted the existing Node `MODULE_TYPELESS_PACKAGE_JSON` warning for
`lessons-state.ts`; execution continued. No dependency/configuration change was
made to suppress it. There was no full-suite retry or separate diagnostic
browser run.

## Seven failures and diagnosis

| Case | Observed failure | Source inspection and limits |
|---|---|---|
| Phase 3 handoff: responsive writing and snapshots retain separate versioned actions | `foundation.test.mjs:2072`: `titleBox && saveBar && titleBox.y >= saveBar.y + saveBar.height` is false | The title's position after scroll/focus does not satisfy the sticky-toolbar clearance requirement. The assertion is inside the width loop, starting at 320 px, before its first screenshot. The toolbar now includes submission/history actions and wraps, while controls use fixed `scroll-margin-top: 10rem`; toolbar growth is a plausible cause, not a measured bounding-box diagnosis. This test does not log coordinates. Subsequent loop widths/source-action checks in this case were not reached. |
| Lesson review: backend validation retains the editable draft and field guidance without inventing field errors | `foundation.test.mjs:3007`: expected `/required for submission/`, received `Title` | The test selects `label[for]` and its immediate parent. `LabeledTextarea` nests that label in an inner wrapper; `LessonTextField` renders guidance in the outer wrapper as a sibling, linked to the textarea by `aria-describedby`. This assertion reads the wrong wrapper for the existing markup. Retained text, enabled Save, no revision creation and absence of uncertain state were checked before this failure. Source inspection locates the guidance; this failing assertion does not prove missing accessible guidance. |
| Lesson review: responsive layouts, keyboard confirmation and status at **320 px** | `foundation.test.mjs:3564`: focus/outline conjunction is false | See shared diagnosis below. |
| Same case at **390 px** | Same assertion | See shared diagnosis below. |
| Same case at **768 px** | Same assertion | See shared diagnosis below. |
| Same case at **1024 px** | Same assertion | See shared diagnosis below. |
| Same case at **1440 px** | Same assertion | See shared diagnosis below. |

All five new viewport cases fail immediately after `confirm.focus()`, at the
combined assertion that the button is `document.activeElement` **and** has an
outline style other than `none`. The fixture previously clicked Prepare with
the pointer; application CSS draws the custom outline on `:focus-visible`.
Programmatic focus after pointer interaction is not equivalent to keyboard Tab
navigation, so focus-visible modality is a plausible assertion/setup issue.
The combined assertion does not expose which condition failed; focus loss is
not ruled out by these logs. No assertion was weakened, and actual keyboard
focus visibility is not accepted on this evidence.

These five cases stop **before** screenshots, Enter submission, submitted-status
and overflow assertions, and their administrator keyboard/layout portion.
No new lesson-review viewport screenshots were produced. Thus they do not
establish teacher/history/admin layout acceptance at any of the five widths.
Existing resource layout and draft D1 cases did pass at all five widths; the
shared-shell keyboard case also passed. Those narrower results do not substitute
for the failed workflow cases.

The other workflow cases passed, including teacher duplicate/pending submission,
lost/absent-result recovery, immutable historical sources, exact administrator
approval/requested changes, stale versions, competing decisions, auth pause/session
replacement, wrong-target/permission rejection and protected comment navigation.
The explicit administrator A-history → B rendered scenario remains a pending
manual check; its independently verified state tests are separate evidence.

## Resources and acceptance boundaries

WSL exposes 3,858 MiB RAM and 1,024 MiB swap. Initial available memory was
2,057 MiB, swap used 530 MiB; filesystem checks showed about 1.4 GiB free in
`/tmp` and 944 GiB on the home filesystem. Source-only copying and dependency
symlinking avoided duplicating the installed dependencies. Available memory
sampled during build reached 1,768 MiB; before browsers it was 1,907 MiB.
Browser-run samples remained around 1,789–1,803 MiB available, with swap used
669–676 MiB. After completion, available memory was 1,933 MiB and swap used
676 MiB. These are sampled observations, not continuous peak measurements.

No OOM, browser crash, resource timeout or WSL shutdown was reported during
this build/run. The seven failures are assertion failures, not diagnosed resource
failures. There were no concurrent suites/builds or parallel browser workers.
No system/WSL/Docker/swap settings were changed.

All browser API calls were intercepted fixture responses. **Live NestJS/API and
PostgreSQL browser acceptance remain pending**; no backend/database was started
or accessed. Manual visual inspection, assistive-technology acceptance and the
[numbered manual checklist](lesson-review.md#numbered-manual-checklist--all-pending)
remain pending. Request/state suites and lint were not rerun for this docs-only
verification task; the fresh production build did run its TypeScript check.

Local evidence (temporary paths may disappear after a restart):

| File under `/tmp/lessonforge-browser-20261030-tz26v82a/` | SHA-256 |
|---|---|
| `build.log` | `9ba8fbad60a94359d4efbfa75730c5d2749087ce7a29ca03f3e8a7155b66cb97` |
| `browser.log` | `768cee8fc6a890939340f3a7e98f2c94fa6a1d5090ccf01adb12ac1018eb1423` |
| `source-manifest.sha256` | `fb4a9b68daf272207d54b7811476aaf625cde21217ef9847c857a0fa64b0bc13` |

New repository edits for this task are documentation only. Application/test source
hashes stayed unchanged. `git diff --check` passed; all relative file-link targets
in the three updated/new UI records exist. An explicit trailing-whitespace check
also covers the untracked new record. Final status: 11 modified tracked files,
three untracked files (including this record), nothing staged, same branch/HEAD.
No staging, commit, push, merge or cleanup was performed.

## Rendered corrections — 2026-10-30

The following work is a separate, authorized correction of the seven initial
failures. The initial run/diagnoses above remain historical evidence. Branch,
checkpoint, existing work, dependencies and backend contracts were preserved.

### Reproduction and classification

Ran only the seven affected cases sequentially against the unchanged matching
production build. Diagnostic output preserved the original failure conditions:
**7 executed, 0 passed, 7 failed**, no skipped/cancelled cases. Evidence copy:
`/tmp/lessonforge-rendered-repro-rvci4no6/`, log `reproduction.log`.

| Failure | Concrete evidence | Classification/correction |
|---|---|---|
| Sticky toolbar / focused title | At 320 px, title y=160.4375, height=106; toolbar y=0, height=239.59375; computed title scroll margin=160 px | **Application defect.** Wrapped submission/history controls exceed the fixed margin. Measure toolbar height locally with `ResizeObserver`; use measured height + 3 rem for fields, descriptions, IDs and focus targets. Remove the source heading's conflicting `scroll-mt-40`. |
| Guidance assertion | Title textarea references `_r_0_-hint`; its description contains “nonblank text is required for submission.” Its inner parent contains only label/textarea, while the referenced hint is an outer sibling | **Test defect.** Follow the actual control's `aria-describedby`, require a visible referenced hint containing the guidance, and retain text/save/no-revision/no-uncertainty assertions. Do not invent a field error from a generic backend 400. |
| Focus assertions at all five widths | Pointer-origin `.focus()`: active=true, `:focus-visible`=false, outline-style none. Tab then Shift+Tab: active=true, `:focus-visible`=true, solid 3 px `rgb(38, 38, 38)` outline on white | **Test defect.** Reach confirmation through real Tab navigation from the workflow heading. Assert active element, focus-visible, nonhidden outline at least 2 px and contrast at least 3:1 against button and surrounding backgrounds. Current application outline styling needed no change. |

No original failure was attributed to an environment/resource issue. The
contrast helper checks the focused button itself, rather than its parent or a
particular color string. Canvas converts computed CSS colors to sRGB before the
contrast calculation; valid Tailwind `oklch(...)` backgrounds are supported.
The test verifies this application's current outline treatment; it does not
prescribe a particular outline hue or solid-only line style.

### Additional problems exposed by the stronger checks

The first corrected targeted run passed **5/7**. Native validation placed an
invalid timing field at y=850.21875, height=50 in a 900 px viewport; the associated
guidance/error text was below the viewport. The 320 px administrator focus check
also exposed the diagnostic helper's RGB-only parsing of the valid background
`oklch(0.97 0 none)`. Added local focus clearance that includes labels and
descriptions, and corrected color normalization without changing contrast limits.

The next run passed **6/7**, exposing the source-heading utility override:
heading y=160.15625, height=82.5 behind the same 239.59375 px toolbar. Removing
the fixed utility lets the measured margin apply to the actual fragment target.

A subsequent **6/7** run reached the previously blocked source actions but
stalled waiting for selection. This was an introduced application regression,
not a resource failure. Two one-case diagnostic runs reproduced it. The pointer
trace showed Select at y=829.71875 (height=70), pointer-down y=864.71, then focus
scrolling moved Select to y=127.71875. Pointer-up/click landed on lesson content;
the fixture received **no selection POST**, lesson version stayed 4, sources empty.
Focus clearance now skips pointer-focused actions while retaining keyboard and
text-control clearance. The original pointer-click/versioned source assertions
passed afterward. Temporary event instrumentation and its shortened diagnostic
wait were removed; original waits and meaningful assertions remain.

### Final implementation and targeted evidence

Only `lessons-panel.tsx`, `globals.css` and the rendered test file changed for
the correction. The toolbar measurement is scoped to its mounted editor;
observer cleanup disconnects on editor close/unmount. It does not touch lesson
state, saved versions, recovery, session disposal, requests or navigation guards.
No API, permission, immutable revision/snapshot or review behavior changed.

The existing clearance case now additionally checks labels, referenced hints,
native-invalid timing focus/error descriptions and introduction/source fragment
targets at **320/390/768/1024/1440 px**. Its save/source-version/text-preservation
assertions remain. Existing workflow viewport cases now use keyboard Tab/Enter,
check actual focus and contrast, then reach submission status, immutable revision,
overflow, administrator comments → approval focus, and screenshots at every width.

First passing targeted result: **7 passed, 0 failed, 0 skipped/cancelled**, exit 0,
58,562 ms. All five previously blocked workflow viewport paths completed.
Screenshots exist at `/tmp/lessonforge-review-{teacher-confirm,history,admin}-{width}.png`
and `/tmp/lessonforge-phase3-handoff-{writing,sources}-{width}.png`. Existence and
automated geometry checks do not constitute manual visual acceptance.

### Commands, source identity and remaining verification

Final verification copy: `/tmp/lessonforge-rendered-correction-_qjhf2ft/frontend`,
excluding `.env*`, `.next` and TypeScript caches on creation, reusing installed
dependencies via symlink. Only changed source/tests were copied into it between
targeted corrections. No real environment files were read. All **56** current
application/public/test/configuration/manifest inputs matched before the full run.
The first passing seven-case source manifest was
`0b392d1e4154e2bca884ab36502addace599dccabef9753906a706da44004f39`, build ID
`rgaU5S-AcpjShC_lrnFdU`; the final scoped source identity is recorded below.

Commands from this copy ran sequentially (no concurrent suites/builds):

```bash
npm run lint
NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=512 npm run typecheck
node --test --test-isolation=none --test-concurrency=1 test/*.test.mjs
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 CIRCLE_NODE_TOTAL=2 NODE_OPTIONS=--max-old-space-size=512 NEXT_TELEMETRY_DISABLED=1 npm run build -- --webpack
```

Lint, standard TypeScript (`next typegen && tsc --noEmit`) and **135 request/state
tests** passed. Production builds passed after each application correction;
the final build and all targeted checks used the final source. Each build kept
the established 512 MiB per-process Node heap ceiling and one Next worker.
No interrupted build result was reused.

For targeted browser runs, the exact process-local Playwright/browser/library/ALSA
overrides from the earlier full command above, plus `NEXT_TELEMETRY_DISABLED=1`,
prefixed:

```bash
node --test --test-isolation=none --test-concurrency=1 --test-name-pattern='responsive writing and snapshots|backend validation retains|Lesson review: responsive layouts' test/rendered/*.test.mjs
```

The two additional diagnostics used only `--test-name-pattern='responsive writing and snapshots'`.
The complete follow-up uses the same runtime prefix with `npm run test:browser`;
its existing script enforces concurrency one. Logs retain each attempt separately:
`targeted.log`, `targeted-final.log`, `targeted-complete.log`,
`selection-diagnostic.log`, `pointer-diagnostic.log`, `targeted-verified.log`,
`build.log`, `build-final.log`, `build-complete.log`, `build-verified.log`,
`lint.log`, `typecheck.log`, `state.log`, `browser-complete.log`.

### Full-suite regression and final scoped correction

The first complete follow-up ran once after the seven targeted cases passed:
**91 executed, 89 passed, 2 failed, no skips/cancellations**, exit 1,
215,487 ms (`browser-complete.log`). All seven original failures passed.
The unchanged initial-open regressions caught an introduced clearance-scope
defect: at 320 px the initial title was y=991.4375, height=106; at 390 px it was
y=921.46875, height=106, both outside a 900 px viewport. The broad CSS selector
had applied the measured scroll margin to the editor heading **before** the
toolbar. This was an application regression, not an invalid test assumption.

The final selector applies measured margins only inside following siblings of
`[data-draft-save-controls]`. Focus clearance also skips targets before the
toolbar. Initial editor-heading behavior is retained, while targets after the
sticky controls receive the measured clearance. No assertion was changed to
resolve either initial-open failure.

Rebuilt after this source change, then ran the original seven cases **and all
five D1 initial-open/create/scrolled-Save cases** together: **12 passed, 0 failed,
0 skipped/cancelled**, exit 0, 72,882 ms (`targeted-scoped.log`). The targeted
pattern was extended with `|D1 initial open/create`; all other flags/overrides
were unchanged. Lint and standard TypeScript were then rerun and passed on this
final source (`lint-scoped.log`, `typecheck-scoped.log`). The earlier 135-test
request/state run remains valid: this last adjustment changes only component/CSS
presentation, and its tested state/request modules, fixtures and unit-test files
are unchanged. No state/request pass is inferred from rendered fixtures.

Final build log: `build-scoped.log`, exit 0; compilation 34.3 s, TypeScript
11.2 s, ten pages generated with one worker. Build ID:
`G8SVg6YyiC-HPm6D_6GoP`. Final 56-file source manifest:
`source-scoped-manifest.sha256`, digest
`c6f19f69cb93b4cd102b1f2ea193f6d10b23ee15404bbf0481a542e058dda0cc`.
All files match the workspace before the final complete browser run. Earlier
source manifests/logs were retained, not overwritten by this final result.

The final complete browser run used the same exact six process-local overrides
and `npm run test:browser`, logging separately to `browser-scoped.log`:
**91 executed, 91 passed, 0 failed, 0 skipped/cancelled/todo**, exit 0,
332,578 ms (about 5 minutes 33 seconds). This second full run followed an actual
source correction and passing targeted checks; there was no automatic full-suite
retry after a resource failure. All 56 inputs still matched the final manifest
and verification copy after completion.

The full run exercised teacher confirmation via Tab/Enter, submitted status,
immutable revision/history overflow checks and administrator comments → approval
focus/contrast and layout at every width: **320, 390, 768, 1024 and 1440 px**.
All 15 corresponding workflow screenshots exist. Existing navigation, resource,
initial-open and source-action regressions also passed. No assertions were
removed or timeouts raised to obtain this result.

Memory was checked before builds and browser runs, which remained sequential with
one browser worker and one harness-owned server. Across this correction, sampled
available memory ranged from about 1,349 MiB during lint to 2,086 MiB early in
preparation; swap used increased from 680 to 730 MiB. The final full run started
with 1,946 MiB available; samples during it reached 1,456 MiB, and the final
post-run inspection showed 1,888 MiB. These are samples, not peak measurements.
There was **no observed OOM, browser crash, WSL shutdown or resource failure**.
The earlier selection wait failure was traced to click cancellation as documented
above. No system configuration or dependency changes were made. Final listener
inspection showed ports 3000/3210 free; no unrelated process was stopped.

Final logs under `/tmp/lessonforge-rendered-correction-_qjhf2ft/` (temporary
artifacts can disappear on restart):

| Evidence | SHA-256 |
|---|---|
| `build-scoped.log` | `8e2cbc38db17f374c1021ad97b7abc0f8187797e223134ccaf0099e0a299434f` |
| `targeted-scoped.log` | `34d6c7bbb756755a6671e2e84535e7fa00728a4c94d928e9df862cffacf84679` |
| `lint-scoped.log` | `596cb56788cfc0dfab4886fb07703457a292cd1e556aca9d7ab6a3620fa71873` |
| `typecheck-scoped.log` | `bdcc1dc693fa49646c05164ff0acf579a3aaff6f7dfedc23a980996f075510f9` |
| `state.log` | `07ccd659a1bb3c06c4e48d66115811d986a24ae6c356d7c45d6b86792b4fa081` |
| `browser-scoped.log` | `dbe325210a0448c0762d1eb332c8cf17a899be7404d587d40aca5e44fe5ead07` |

All API calls remain intercepted fixtures. Live API/PostgreSQL and manual
acceptance, including the existing numbered checklist, remain pending. The
correction is ready for independent review. Existing changes remain unstaged;
no branch change, staging, commit, push, merge or cleanup was performed.

Final `git diff --check` and explicit whitespace/relative file-link checks for
all three touched UI records passed, including this untracked file. Comparison
with the pre-correction verified copy confirms only the three application/test
files named above changed; existing request/state work was preserved. Git remains
`feat/frontend-lesson-review` at `2b96627`, with 12 modified tracked files, three
untracked files and an empty index. These totals include pre-existing work.

## C1 shared-guidance focus correction — 2026-10-30

This is the implementation follow-up to the independent P2 finding C1. The
reviewer's findings and earlier evidence remain historical; this correction is
**awaiting independent verification**. Live API/database, manual visual and
assistive-technology acceptance remain pending.

### Reproduction, changes and regression coverage

Fresh browser reproduction succeeded with permitted process/socket execution;
it was not blocked by the earlier review's EPERM limitation. Reused the
source-matched previous production build for reproduction, without rebuilding
unchanged application sources. Seven selected new rendered cases executed:
**1 passed, 6 failed**, no skips/cancellations. The local native-error case
already passed. The new wrapped-label case was added afterward, not claimed as
part of that reproduction. Log:
`/tmp/lessonforge-c1-repro-_5aykn3p/reproduction.log`.

Measured examples: focusing visible material rows at 320 px moved scrollY from
2460 to 2612; at 1024 px from 1616 to 1768, while their shared hints were at
y=-212.6 and -256.0. Objective-row cases also jumped. Refocusing an already
visible oversized field moved scrollY from 928 to 950. These are actual browser
coordinates, separate from the review's earlier synthetic callback probes.

Application changes are limited to `lessons-panel.tsx` and `globals.css`:

- Shared objective/material guidance and the shared subject/grade hint are
  marked `data-draft-group-hint`. They retain their IDs, text and all original
  control/fieldset `aria-describedby` references. They are excluded only from
  **local scroll bounds**, not from accessibility associations or rendering.
- Local bounds still include the control, its actual labels, local guidance and
  errors. Choose the smallest vertical offset needed to fit a feasible local
  span, rather than always calling fixed-alignment `scrollIntoView`.
- When the full local span cannot fit, prioritize label/control, then control
  alone. An oversized control already intersecting the usable viewport stays
  stable. A fully offscreen control can still be revealed. Clamp offsets to
  actual page scroll limits and ignore subpixel corrections; no repeated attempt
  is made to fit impossible bounds or scroll past the page edge.
- ResizeObserver can now reveal the active control when reflow moves it wholly
  above the usable area; the old nonnegative-top guard prevented that. Existing
  observer cleanup, pointer-action exclusion, preceding-heading exclusion,
  session isolation and navigation guards remain intact.
- Array rows carry `data-draft-array-item`; their controls use toolbar height +
  8 px native scroll margin because the callback measures actual labels. Other
  fragment/field scroll-margin styling is preserved.

The first corrected targeted run passed **6/8**. One test setup left a wrapped
row's label/Remove action too close to the toolbar; it now explicitly checks
that both labels/actions and the two fields are clear before asserting no jump.
This strengthens the already-visible precondition; it does not remove clearance
assertions. A two-case diagnostic then passed the row case but reproduced a
40 px native scroll after resize: scrollY 1471 → 1431, toolbar height 138 px,
computed margin 186 px, **no callback `scrollBy` calls**. This established the
remaining native-margin issue and justified the scoped array margin correction.
Temporary diagnostic wrappers were removed from the final tests.

Eight C1 rendered cases now cover objectives and materials with multiple entries
at 320/1024 px, forward/backward Tab without movement, distant shared hints,
unchanged description associations, active-row clearance through toolbar resize
at 320/390/768/1440 px, a truly obscured mobile local error, a wrapped label with
a resized feasible field, and repeated focus on an oversized field with
impossible full bounds. The existing save/source/snapshot/version/session/
navigation/workflow assertions and timeouts are retained.

Final targeted run combined these eight cases with the existing twelve
clearance/initial-open/workflow cases: **20 passed, 0 failed/skipped/cancelled**,
exit 0, 80,470 ms. It exercised all five workflow widths and the unchanged
initial-open cases before the complete suite.

### Source provenance and actual commands

Verification copy: `/tmp/lessonforge-c1-correction-jvzbxn3z/frontend`, copied
without `.env*`, `.next`, TypeScript cache or installed dependencies; its
`node_modules` symlink reuses the repository's installed dependencies. No real
environment files, backend or database were accessed. Final 56-file source
manifest SHA-256:
`2c49d9f3aeab2e554f2476da43e694a5df7f0f77c4252ff6ea79b0454099c21f`.
All application/public/test/configuration inputs match the workspace before the
complete run. Production build ID: `CsE1y89z-p9kEDgRuY6VJ`.

Two builds ran sequentially as application changes required them; both passed.
The final build compiled in 23.7 s, checked TypeScript in 12.7 s and generated
ten pages using one Next worker. The matching build was needed for targeted
production-browser tests and reused unchanged for the full run afterward.
Actual build command from the copy:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 CIRCLE_NODE_TOTAL=2 NODE_OPTIONS=--max-old-space-size=512 NEXT_TELEMETRY_DISABLED=1 npm run build -- --webpack
```

All browser commands use this exact process-local prefix (no permanent changes):

```bash
PLAYWRIGHT_MODULE=/home/mariga/design-work/lessonforge-ui/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/home/mariga/.cache/lessonforge-browser-runtime/browsers LD_LIBRARY_PATH=/home/mariga/.cache/lessonforge-browser-runtime/root/usr/lib/x86_64-linux-gnu ALSA_CONFIG_DIR=/home/mariga/.cache/lessonforge-browser-runtime/root/usr/share/alsa ALSA_CONFIG_PATH=/home/mariga/.cache/lessonforge-browser-runtime/root/usr/share/alsa/alsa.conf NEXT_TELEMETRY_DISABLED=1
```

The prefix precedes each command below; it is not a standalone setup command.
Rendered command tails and results:

| Command tail | Log / result |
|---|---|
| `node --test --test-isolation=none --test-concurrency=1 --test-name-pattern='C1 focus clearance:' test/rendered/*.test.mjs` | Reproduction above: 1/7 passed; initial correction `targeted.log`: 6/8 passed |
| `node --test --test-isolation=none --test-concurrency=1 --test-name-pattern='visible Learning objectives rows.*320px\|wrapped/resized toolbar' test/rendered/*.test.mjs` | `focus-diagnostic.log`: 1/2 passed; native-scroll diagnosis |
| `node --test --test-isolation=none --test-concurrency=1 --test-name-pattern='C1 focus clearance:\|responsive writing and snapshots\|backend validation retains\|Lesson review: responsive layouts\|D1 initial open/create' test/rendered/*.test.mjs` | `targeted-final.log`: 20/20 passed |
| `npm run test:browser` | `browser.log`: 99/99 passed; existing script explicitly uses `--test-concurrency=1` |

The escaped pipes in the Markdown table represent literal regex `|` operators,
without backslashes in the actual shell single-quoted pattern.

The following additional checks ran one at a time and passed:

```bash
NODE_OPTIONS=--max-old-space-size=512 npm run lint
NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=512 npm run typecheck
NODE_OPTIONS=--max-old-space-size=512 node --test --test-isolation=none --test-concurrency=1 test/*.test.mjs
```

Standard TypeScript is `next typegen && tsc --noEmit`; request/state tests:
**135 passed, 0 failed/skipped/cancelled**, exit 0. They include existing draft,
resource, workflow, R1 targeting and navigation regressions. No dependency,
manifest, lockfile, backend or API changes were made.

### Resources and complete-run result

The complete rendered suite ran **once after the final targeted correction
passed**: **99 executed, 99 passed, 0 failed/skipped/cancelled/todo**, exit 0,
476,440 ms (about 7 minutes 56 seconds). This includes the unchanged original
91 cases and eight new C1 cases. All five workflow viewport paths completed.
Line-by-line comparison with the pre-C1 test copy confirms only insertions;
existing test cases/assertions/timeouts were preserved.

All 56 input hashes matched both the workspace and verification copy after the
run. All API responses were intercepted fixtures. This is fresh rendered evidence,
not real NestJS/PostgreSQL, real-actor authorization or manual acceptance.

Memory/listeners were checked before heavy steps. Execution stayed sequential:
one browser worker, one harness-owned production server and no concurrent suite
or build, using the existing user-local runtime. Initial available memory was
1,516 MiB with 764 MiB swap used; before the full suite it was 1,589 MiB with
1,023 MiB swap used. During lint one sample reached 755 MiB available with full
swap, recovering to 1,704 MiB after lint exited successfully. Full-suite samples
reached 1,222 MiB available; after final server/source inspection it was 1,621 MiB.
These are samples, not measured process peaks. Memory pressure and slow cases
were observed, but **no OOM, browser crash, WSL shutdown or resource-related
check failure was reported**. No failing full suite was retried. No permission
block occurred in these permitted browser runs; the earlier independent EPERM
results remain separate historical evidence.

Ports 3000/3210 were free before launch and after the harness completed. No
duplicate server, unrelated process termination, cleanup, installation, system
change, staging, commit, push, merge or branch change was performed.

Final evidence under `/tmp/lessonforge-c1-correction-jvzbxn3z/` (temporary files
may disappear on restart):

| File | SHA-256 |
|---|---|
| `build-final.log` | `75549eee70bbba8f406b118bdf18b1510209750eda789494379c2e2f790ba51f` |
| `targeted-final.log` | `464601c86b1cba186449724289c7530402188048483161413f4d674d2df1d870` |
| `lint.log` | `596cb56788cfc0dfab4886fb07703457a292cd1e556aca9d7ab6a3620fa71873` |
| `typecheck.log` | `bdcc1dc693fa49646c05164ff0acf579a3aaff6f7dfedc23a980996f075510f9` |
| `state.log` | `cd75dc665ef09bb48c52d4d2ba24a028eb2e6611422126d5b112771275af447a` |
| `browser.log` | `60434a52fa2e834c89926b71e710a3de80ddd0eb89d8f5b858dfdd33700de712` |

C1 is marked corrected awaiting independent verification. Live API/database,
manual visual/keyboard and assistive-technology acceptance remain pending.

Final checks passed: `git diff --check`, explicit whitespace/final-newline checks
for all four UI records (including untracked files), and 25 relative file-link
targets. Only the three application/test files named above changed from the
pre-C1 verified source. Git remains `feat/frontend-lesson-review` at `2b96627`,
12 modified tracked files, three untracked files, empty index. Existing work was
preserved; no staging, commit, push, merge, branch change or cleanup occurred.

## C1 independent verification follow-up — 2026-10-30

**C1 resolved; no new actionable finding.** The [independent verification](lesson-review-independent-review.md#c1-independent-verification--2026-10-30)
verified all 56 workspace/copy inputs, the manifest digest, matching build ID and
all six final log digests above. The 99 browser, 20 focused rendered, 135 state,
lint, standard TypeScript and build passes are **source-matched reused evidence**,
not fresh independent suite runs. All previous rendered assertions remain;
the test correction is insertion-only. Fresh independent AST/CSS boundary checks
and 24 extracted-callback geometry/lifecycle probes passed without editing
application/test code.

Memory was checked first (about 1.6 GiB available, swap nearly full). A single
loopback bind and a single installed-Chromium launch preflight failed with EPERM;
no browser suite/server, build or repeated heavy retry followed. Independent
native row entry/exit, default behavior and row focus-ring browser probes were
not run. Source inspection confirms unchanged native focus order/defaults and
outlines, no new key interception, trap or focus reassignment, and unchanged
session/navigation/workflow protection. Live API/database and all manual
acceptance remain pending; earlier awaiting-verification statements above are
historical handoff statuses. Only UI documentation was updated; Git operations
and application/test changes were not performed.
