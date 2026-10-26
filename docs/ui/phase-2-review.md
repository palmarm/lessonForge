# Phase 2 independent pre-commit review

Reviewed 2026-10-26 on `feat/frontend-design-resources`. No commit blockers were
found in the reviewed Phase 2 change. The non-blocking heading issue was corrected
in the [R1 follow-up](#r1-heading-correction-follow-up).
This is not full manual or real API/database acceptance.

## Findings

### R1 — P3: resource headings skip levels (resolved by focused correction)

Locations: `frontend/src/components/resources-panel.tsx:139`, `:204`, `:286`,
`:305`, `:309`, and `:379`.

Opening a teacher resource detail renders its title as `h1`, followed directly by
`h4` Source reference and Resource text headings. List card titles and the
administrator editor title are `h3` directly beneath the page `h1`. Phase 2
replaced the former panel `h2` with the page title and removed the teacher detail
`h3`, but retained the old descendant levels. This leaves misleading gaps for
heading-based assistive-technology navigation. The content and controls remain
reachable; this is not a data-loss or permission blocker.

Use `h2` for sections directly under the page title and `h3` only under a real
`h2` parent. Detail section levels can differ between teacher page detail and
administrator nested detail. Keep visual classes independent of heading rank.
Add a focused visible-heading assertion when correcting this. No application or
test code was changed during this review.

### Verification reporting correction — resolved in documentation

The previous Phase 2 verification table described route generation/TypeScript as
passing without labeling that row as isolated. The preceding prose mentioned the
repository failure, but the table could be mistaken for a standard-check pass.
The integration record now distinguishes the historical standard failure,
isolated pass, and newly executed standard pass. Details follow below.

## Base and review scope

`HEAD`, local `staging`, and `origin/staging` all resolve locally to
`e6412ccded1d7731469b3813f45bb46551cb47a2`
(`feat(frontend): add design foundation and guarded workspace navigation (#17)`).
No fetch was performed; these are local refs, not a claim about remote freshness.
The branch matched the request. The index was empty. The working tree was
expectedly dirty with Phase 2: nine tracked modifications and the untracked
`frontend/src/app/resources/[id]/page.tsx`. There were no Phase 2 commits to use as
a different base. Review covered `git diff HEAD` and the untracked file contents,
not only the implementation report.

Read `AGENTS.md`, the project README/specification/architecture/roadmap/branching
guidance, `~/design-work/lessonforge-ui/DESIGN_HANDOFF.md`, the resource contract,
and the UI integration/index/Phase 1 review records. The Phase 1 shell, navigation
correction and session-keyed workspaces are present in the actual base.

- Teacher cards use summary fields supplied by the API; content/citation come
  from exact detail reads. Server `nextAfter` controls pagination. Direct UUID
  detail routes, refresh, invalid IDs, retired/unavailable responses, and hiding
  stale detail were inspected and exercised. No preview descriptions, slug
  fixtures or static detail routes were introduced.
- Administrator create/edit/retire stay in the mounted local store. The five
  content fields, native required/max-length controls, fixed subject/grade,
  transport validation, UUIDs and expected-version contracts are preserved.
  Retirement submits the viewed version; comparison does not adopt a version.
  Retired detail is read-only, including disabled retained edits when comparison
  discovers retirement.
- Recoverable errors and comparison reads retain entered text. Known uncertain
  writes reconcile their exact target; unknown-ID creation retains list paging
  and candidate inspection. Acknowledgement and version adoption remain explicit.
  No automatic write retry, lesson write or snapshot refresh was added.
- Auth pause/invalidation, stale-result rejection and user/role/session disposal
  remain in the existing stores/providers. New route visibility preserves those
  owners. Navigation remains protected for dirty, pending and uncertain work;
  direct-detail history was additionally exercised in both browser guard modes.
  Existing fragment regressions were reviewed and their recorded results reused.
- Loading, empty, validation, saving, success, failure, conflict and uncertainty
  branches remain visible. Labels, error focus, retirement focus and sticky Save
  presentation were reviewed. Heading ranks had R1, now corrected below.
- Backend contracts, migrations, lesson state/snapshots, dependencies and
  authentication transport were unchanged. No Phase 3, AI, submission/review,
  library, delete/reactivate, mock authentication or browser persistence was added
  to application code. Test fixtures remain in test code.

## Typecheck discrepancy

The recorded implementation-time root command was:

```bash
npm run typecheck --prefix frontend && npm test --prefix frontend
```

The first script runs `next typegen && tsc --noEmit`. Route generation reported
success, then TypeScript exited 2 with these diagnostics (paths relative to
`frontend`); the chained tests did not run in that invocation:

```text
.next/dev/types/routes.d.ts(60,3): TS1128
.next/dev/types/routes.d.ts(60,5): TS1109
.next/dev/types/routes.d.ts(63,1): TS1128
.next/dev/types/validator.ts(62,1): TS1434
.next/dev/types/validator.ts(64,8): TS1005
.next/dev/types/validator.ts(65,1): TS1128
```

The recorded file inspection showed duplicated/truncated generated tails:
`routes.d.ts` had dangling `params`/`children`/mapped-intersection text after the
completed declaration; `validator.ts` had a `peof handler>` fragment and repeated
type-assertion tail. These were generated syntax errors, not application type
diagnostics. `frontend/tsconfig.json:30-31` includes both `.next/types/**/*.ts`
and `.next/dev/types/**/*.ts`; that configuration is unchanged from the Phase 1
base. Installed Next's `dist/cli/next-typegen.js` writes production `.next/types`,
so successful production type generation does not repair malformed development
types that the subsequent compiler also includes.

Before any review generator ran, both development files were already syntactically
valid and included `/resources/[id]`. Both had modification times of
2026-10-26 15:01:01 +03:00; their filesystem birth times were 2026-10-19. Old birth
times do not date the malformed contents. No preserved pre-Phase 2 malformed
version or responsible writer was available. Therefore the evidence establishes
pre-existing inclusion of development types, **not** that the corruption predates
Phase 2 or was introduced by it. An interrupted/concurrent generator is possible,
but unproven; no tracked Phase 2 generator/configuration change explains it.

The independent standard command was then executed in the actual checkout:

```bash
npm run typecheck --prefix frontend
```

**Result: passed, exit 0.** Both development-file hashes remained unchanged by
this check. `next typegen` regenerated production types and changed ignored
`next-env.d.ts` imports from development to production type paths as expected.
No generated file was manually edited/deleted and no cleanup was performed.
Before-check file copies/hashes are in the temporary review evidence directory
`/tmp/lessonforge-phase2-independent-review-ybrtpdm5`.

The earlier isolated check used `/tmp/lessonforge-phase2-review/frontend`, excluding
the checkout's `.next`, `.env*` and `tsconfig.tsbuildinfo`, with installed
`node_modules` reused via symlink. Its generator/build created fresh production
types, with no `.next/dev/types` directory. All `src` and `test` file contents were
independently compared and matched the review checkout. This validates the source
against fresh production types, but excludes the checkout's development-generated
inputs, environment configuration, live API/database and fresh dependency
installation. It must never substitute for the standard repository check.

No remediation is currently required. If the malformed development files recur,
first preserve their contents and diagnostics and stop competing Next processes
deliberately. With existing dependencies, regenerate the development output using:

```bash
npm run dev --prefix frontend -- --webpack --hostname localhost --port 3000
```

This starts the development server and its route-type writer in `.next/dev/types`;
after it is ready, stop that server and rerun the standard typecheck above.
Installed Next's `setup-dev-bundler.js` writes the development manifest and
validator on route discovery. This recovery procedure was not executed in this
review. Do not delete generated files, weaken `tsconfig` exclusions or hand-edit
generated declarations to conceal the failure. If regeneration still produces
malformed output, preserve it and investigate the generator/process interaction.

## Checks and evidence

New independent checks:

| Check | Result / boundary |
| --- | --- |
| Branch, refs, index, full tracked diff and untracked UUID route | Reviewed against `e6412cc`; index empty |
| Standard repository `npm run typecheck --prefix frontend` | Passed, exit 0; historical failure remains recorded above |
| Resource API/state/reconciliation and navigation policy tests | 39 passed, 0 failed; mocked transport/state |
| Additional Chromium probes | 10 passed, 0 failed; intercepted API, matching existing production build |
| Application/test source preservation | Before/after hashes match; review changed documentation only |
| Affected documentation links/anchors and whitespace | Passed; `git diff --check` passed |

Targeted state command, from repository root:

```bash
node --test --test-isolation=none frontend/test/resources-api.test.mjs frontend/test/resources-state.test.mjs frontend/test/resources-reconciliation.test.mjs frontend/test/workspace-navigation.test.mjs
```

Additional browser probes used a temporary copy of the existing fixture harness
and the already-built `/tmp/lessonforge-phase2-review/frontend`. The installed
Playwright module, Chromium and library overrides are documented in the
[integration record](frontend-design-integration.md#commands-and-environment-limits).
No dependencies or browsers were installed. Test server startup used local
process/socket permission. The temporary probe script is
`/tmp/lessonforge-phase2-independent-review-ybrtpdm5/browser-probes.test.mjs`:

- Invalid ID rejected without a resource request; valid direct detail refresh
  performs detail reads without a list read; retired teacher detail fails closed.
- Dirty draft navigation through resource list/detail and Back/Forward allows
  cancellation or explicit departure while retaining text, in both guard modes.
- Back from a pending or uncertain draft to direct detail stays blocked, in both
  modes, with one write and retained text.
- Retirement sends the viewed version despite changed server data; uncertain
  outcome reads the exact target and requires acknowledgement, with one write.
- Administrator Back to list retains text on cancellation, clears only after
  explicit discard and restores heading focus.

Reused implementation evidence: lint; isolated TypeScript; 92 request/state tests;
56 final-source rendered tests; five focused viewport/save-bar checks; and the
Webpack production build. The full rendered suite includes auth transitions,
late results, session isolation, creation recovery, fragments and both history
guard modes. These were reviewed rather than rerun wholesale. The focused state
suite was repeated to retain its final output after an earlier output truncation.

Visual evidence is the implementation's recorded agent screenshot inspection at
320/390/768/1024/1440px and save-bar viewport captures, using test content. No new
visual pass was performed in this review. This is distinct from the rendered
interaction assertions, and neither constitutes full manual accessibility or
design acceptance. No real API/database browser checks were run. Historical user
reports remain historical; they do not verify Phase 2 persistence or snapshots.

## Pending checks and final state

Keep real API/database resource pagination and direct reload, durable create/edit/
retire, actual auth/cookies, cross-account isolation, and snapshot preservation
through administrator changes pending. Full keyboard order, zoom, assistive
technology, Firefox/WebKit, deployed HTTPS/security, full integration acceptance,
teacher-draft acceptance and the default Turbopack environment check remain pending.
The user-deferred Phase 1 manual Back/Forward checks remain deferred until after
Phase 3; automated probes do not complete them. Phase 3 is unimplemented.

Only this review record, the UI index and the Phase 2 integration verification
record were edited during review. Application/test files were preserved. All
changes remain unstaged on `feat/frontend-design-resources`; no branch operation,
cleanup, install, database change, stage, commit, push or merge was performed.

## R1 heading correction follow-up

The authorized correction changes only resource heading ranks in
`frontend/src/components/resources-panel.tsx`. The surrounding teacher list,
teacher UUID detail and administrator route components return no extra heading;
the persistent workspace continues to own the single visible page `h1`.

- Teacher and administrator resource card titles are `h2`.
- Teacher detail retains its API title as `h1`; Source reference and Resource
  text are `h2`, removing the former `h1` to `h4` jump.
- Administrator selected-resource title is `h2`; its Source reference, Resource
  text and retirement-confirmation headings are `h3`.
- Administrator create/edit form titles are `h2`, as siblings of the detail
  section during comparison rather than subsections of its resource text.

The local detail-heading tag chooses `h2` for the teacher page and `h3` under the
administrator detail title. No shared heading component was changed. Existing
visual classes, layout, wording, IDs, focus targets and action/state handling are
preserved. Two focused rendered regressions assert the complete visible main
heading outline through teacher list/detail/direct reload and administrator list,
create, edit, confirmation and retired read-only views. The confirmation test also
checks that focus still reaches its heading.

Correction verification uses the actual repository for lint and the standard
TypeScript script. Focused Chromium checks use the current source in a fresh
temporary copy at `/tmp/lessonforge-phase2-heading-correction-d933eqik/frontend`,
excluding `.next`, `.env*`, and `tsconfig.tsbuildinfo`, with existing dependencies
symlinked. Only that temporary runner starts `next dev --webpack` instead of the
usual production server and warms the resource routes before the timed checks;
no application configuration was changed. Browser tests
intercept API responses and provide rendered semantic evidence, not real API/
database or manual screen-reader evidence. No new screenshot/visual pass is claimed.

The previous 92-case request/state suite, 56-case full rendered suite, five
viewport/save-bar checks and Webpack production build remain historical evidence
for the source before this heading correction. They were reused for unaffected
behavior, not reported as rerun on the correction. Real API/database acceptance,
full accessibility/manual checks and deferred Phase 1 Back/Forward checks remain
pending as described above. No dependencies were installed and no generated files
were cleaned.

Executed correction commands from the repository root:

```bash
npm run lint --prefix frontend
npm run typecheck --prefix frontend
```

Both passed, exit 0. The TypeScript result is the standard repository check,
including generated types under both configured `.next` paths. The earlier
generated-file failure and the narrower isolated pass remain recorded above.
A TypeScript-AST comparison also confirmed that all JSX `className` attributes
and literal UI wording match the source captured before this correction.

Focused rendered command (from the temporary frontend, using the installed
Playwright/browser/library overrides in the integration record):

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 node --test --test-isolation=none --test-concurrency=1 --test-name-pattern='Phase 2 heading outline:' test/rendered/foundation.test.mjs
```

The initial restricted attempt could not start its local server. A permitted
attempt started Next but timed out before cold compilation completed. An interim
temporary-runner readiness adjustment also ended before startup; that loop was
corrected. None of those startup failures exercised the outline assertions or
counts as a passing rendered check. The repository's production runner was not
changed to accommodate development startup.

After startup readiness was corrected, another cold run timed out in the resource
interactions (teacher test's 45-second timeout; administrator `page.goto`'s
30-second timeout). The final temporary-runner setup compiled the three resource
routes before running the same assertions. **Result: 2 passed, 0 failed, 0
canceled**, with no page runtime errors. Teacher list/detail and administrator
list/create/edit/confirmation/retired outlines matched the exact expected levels;
direct teacher-detail reload and confirmation focus also passed. The production
runner's timeouts and application behavior were not weakened.

| Correction check | Result |
| --- | --- |
| Focused rendered heading outlines | 2 passed; Chromium, current-source Webpack development server, intercepted API |
| Repository frontend lint | Passed, exit 0 |
| Standard repository TypeScript | Passed, exit 0 |
| JSX class attributes / literal wording comparison | Unchanged from pre-correction source |
| Affected documentation links/anchors | 20 checked, passed |
| `git diff --check` | Passed |

The user later reported passing teacher browsing, pagination and direct-detail
reload; administrator create/edit persistence and retirement; unsaved-navigation
protection; and visual/keyboard checks. The user skipped additional independent
verification. These reports are attributed to the user and are not new
agent-observed API/database or visual evidence. The report supplied no date,
browser or fixture/backend details. The independent heading verification above
covers the P3 correction; the broader user-reported checks have not been
independently repeated. Phase 1's deferred manual draft Back/Forward checks and
the full draft and lesson snapshot checks remain pending.

All application `src` files in the temporary frontend matched the checkout. The
fixture and assertion portion of the temporary test runner matched the checkout;
only its startup/readiness setup differed. Logs and the before-correction source
copies remain under `/tmp/lessonforge-phase2-heading-correction-d933eqik`.
Changes remain unstaged on `feat/frontend-design-resources` with the index empty.
