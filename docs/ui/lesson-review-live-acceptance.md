# Guided live lesson-review acceptance

## Latest acceptance update — developer-performed live checks

The developer confirmed the following results against the live API/database.
These were **developer-performed checks, not Codex-executed tests**:

- Incomplete submission was rejected.
- Submission → requested changes → editing → resubmission → approval passed.
- Historical revision content, reviews and resource snapshots were preserved.
- The approved lesson disappeared from pending reviews and editable drafts.

This confirms the reported validation, lifecycle, historical preservation and
post-approval list behavior. No additional HTTP statuses, lesson/revision IDs,
versions, browser coverage or database inspection procedure were supplied; none
is inferred. In particular, disappearance from a list alone is not evidence that
an uncertain write failed.

The readiness observations, all-pending checklist and 404 diagnosis below are
retained as **historical evidence from before this confirmation**. Their blocked
or pending statements do not negate these newly confirmed results. The earlier
404 root cause remains unestablished; successful workflow checks do not identify
its cause or establish which startup command/build was used.

Outage/uncertain-write recovery, concurrency/stale-version acceptance,
accessibility, other-browser and HTTPS acceptance remain pending unless
separately evidenced. Unsaved-edit handling, exact saved-version targeting,
refresh/reopen persistence, required-comment validation, two-lesson pagination
isolation and navigation/session-boundary checks are also not established by
this report. The full 12-step checklist is not marked complete.

## Readiness inspection — 2026-10-30

Read root `AGENTS.md`, [the authoritative workflow API](../lesson-review.md),
backend startup/auth configuration source and the existing
[12-step UI checklist](lesson-review.md#numbered-manual-checklist--all-pending).
The user authorizes the existing local database and privately configured test
accounts for this guided acceptance. Earlier disposable-database-only automation
restrictions do not authorize unrelated changes to existing local records.

Actual read-only observations:

- Branch `feat/frontend-lesson-review`; existing changes preserved, nothing staged.
- Docker reports `lessonforge-db-1` running and healthy, loopback port 5433.
  No SQL/schema/account inspection or mutation was performed. Container health
  does not establish application authentication, schema or workflow readiness.
- No listeners on frontend port 3000, API port 3001 or harness port 3210.
  No server was started or stopped by the agent. Other processes were untouched.
- WSL exposes 3,858 MiB RAM; initial sample: 1,681 MiB available and 1,024 MiB
  swap used. No heavy build or automated suite was run for this preparation.
- All 56 frontend application/public/test/configuration inputs still match
  `/tmp/lessonforge-c1-correction-jvzbxn3z/frontend`; its production build ID is
  `CsE1y89z-p9kEDgRuY6VJ`, with API URL compiled as `http://localhost:3001`.
  This matching build can be served without repeating a build/test suite.
- No real environment files or account credentials were read or printed.

## Startup guidance issued — execution not yet confirmed

Terminal A: this installed npm script generates the Prisma client, compiles the
current NestJS source and starts the API once, without a watch process. It uses
the existing private backend configuration and performs its normal connectivity
check. It does not seed, migrate, reset or provision accounts. Its generated
client/build output is local; no authored application/test file is edited.
Confirm the existing configuration targets the intended local database privately;
do not paste credentials into the acceptance record.

```bash
NODE_OPTIONS=--max-old-space-size=512 npm --prefix /home/mariga/projects/lessonforge/backend run start
```

Wait for successful backend readiness before the next command. Expected default
public API URL: `http://localhost:3001/`, response `LessonForge API`. If private
port/origin settings differ, report only the public URLs or sanitized error;
do not change configuration speculatively.

Terminal B: this serves the already verified production frontend on localhost
port 3000. It does not rebuild or start the intercepted-API browser harness.
Use `localhost` consistently for browser/API hostnames and existing origin policy.

```bash
NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=512 npm --prefix /tmp/lessonforge-c1-correction-jvzbxn3z/frontend run start -- --hostname localhost --port 3000
```

Expected sign-in page: `http://localhost:3000/sign-in`. Account sign-in and live
backend readiness are pending user confirmation. Existing privately configured
teacher/admin accounts are reused; no provisioning command is proposed.

## Guided results

Only one numbered test is issued at a time. All twelve tests below are pending;
instructions/expected results are not performed results. The user will execute
UI actions and report sanitized evidence. No live acceptance is inferred from
the earlier 99 intercepted-API rendered passes or database-free state tests.

| Test | Scope | Actual result |
|---|---|---|
| 1 | Submission validation and unsaved edits | Pending; instructions issued |
| 2 | Successful submission of the intended saved version | Not issued/performed |
| 3 | Immutable content and retained resource snapshots | Not issued/performed |
| 4 | Teacher history/detail and refresh/reopen persistence | Not issued/performed |
| 5 | Administrator queue and exact-revision decisions | Not issued/performed |
| 6 | Required comments and decision validation | Not issued/performed |
| 7 | Teacher decision visibility and supported resubmission | Not issued/performed |
| 8 | Older revisions/reviews preserved | Not issued/performed |
| 9 | Two lessons: history/detail/cursor isolation | Not issued/performed |
| 10 | Stale versions and deliberate recovery | Not issued/performed |
| 11 | Pending/uncertain writes, navigation and session boundaries | Not issued/performed |
| 12 | Keyboard, array-row focus, mobile layout and toolbar clearance | Not issued/performed |

### Test 1 instructions and expected evidence

Role: existing teacher test account. Start at **My drafts** after successful
sign-in. Designate a new test lesson A with title
`LF review acceptance A — 2026-10-30`; no existing unrelated lesson or resource
is changed. Leave other submission fields incomplete and sources unselected.
Save once and record the assigned lesson ID and saved version `v`.

Append ` UNSAVED` to its title without saving. Expect unsaved guidance and disabled
Prepare submission, with no submission POST. Restore the exact saved title,
without another save; preparation should become available again.

Prepare submission, inspect the confirmation's lesson ID/version and immutable
saved-only consequences, then confirm **once**. Expected live result: definite
HTTP 400 for the incomplete draft, safe validation guidance, saved text retained,
editable draft and no uncertain-write state. No automatic submission retry.

After a definite 400, open that lesson's history and record the workflow metadata
and revision list: expected `DRAFT`, version `v`, `currentRevisionId: null`, no
revisions. A fresh new lesson's initial successful create is version 1. Read
metadata and the definite rejection together; an empty list alone never proves
an uncertain write failed. If the result is a timeout/network error/503, stop
and report the uncertainty without retrying, refreshing away its candidate or
acknowledging failure. Recovery will follow the actual contract.

Evidence to report: public UI/API readiness; lesson ID; saved version; dirty-state
Prepare behavior; confirmation identity/version; submission HTTP status; safe UI
message/text retention; history workflow/version/current revision and item count.
Use sanitized screenshots or summaries. Do not send credentials, cookies, tokens,
Authorization/Set-Cookie headers, raw HAR exports or private configuration.

No fault injection has been proposed or performed. Any later controlled failure
procedure must first explain exactly which test operation it affects and how to
restore normal behavior. Mutations stay within designated test lessons/resources;
no reset, seed, migration, session cleanup or unrelated data maintenance occurs.

## Reported all-route 404 diagnosis — 2026-10-30

**Status: the reported HTTP 404 cause is not yet established.** No server was
listening during inspection; fresh requests received connection refused, not an
HTTP response. Manual acceptance remains blocked/pending. Missing route files,
cache corruption, an API mismatch or a Turbopack bug are **not** established.
Only this existing record is updated for the diagnosis; no fix is applied.

### Preserved feature and runtime evidence

- Working directory `/home/mariga/projects/lessonforge`; branch
  `feat/frontend-lesson-review`, HEAD `2b966275a624845f3a54bb96869535e5932e8689`.
  Local `staging`, `origin/staging`, both merge bases and checkpoint parent are
  `e9c0ff45c264a8d08614c5b3f01163dc4d779842`. No remote fetch or ref mutation.
- Checkpoint: 16 changed files, including history/review route pages, persistent
  shell wiring, transport/store and draft coordination. Full base-to-working
  feature: 19 tracked changed files plus four current untracked files. The
  working-tree layer has 12 tracked modifications; checkpoint, tracked and
  untracked layers are retained. Backend, package manifests/lockfiles and
  `next.config.ts` have no feature changes. Source, entry-point diffs, shared
  draft changes, test coverage and untracked records were inspected together.
- Two WSL listener/process inspections found no listener on 3000/3001/3210 and
  no Next.js framework process. Windows `Get-NetTCPConnection` also found no
  listener on port 3000. No process was stopped or replacement server started.
- Sequential GETs from WSL to `http://localhost:3000/`, `/sign-in`, `/resources`,
  `/drafts`, `/history` all returned transport error `[Errno 111] Connection refused`.
  Consequently no fresh HTML/status/headers exist to classify the reported 404
  as framework, application, redirect or backend error.
- Retained `frontend/.next/dev/lock` identifies prior PID **129297**, port 3000,
  hostname `localhost`, URL `http://localhost:3000`. That PID no longer exists.
  Its original command and actual process cwd cannot be recovered from a live
  process. This lock is historical metadata, not a running-server identity.
- Retained development artifacts are Turbopack-generated: dev app-paths manifest
  includes `/page`, `/sign-in/page`, `/resources/page`, `/drafts/page`,
  `/history/page` and `/admin/reviews/page`; route wrappers refer to real
  `[project]/src/app/...` modules. Dev logs show compilation and filesystem-cache
  compaction, not a recorded causal routing error. Dev trace contains requests to
  the reported paths but no captured HTTP status establishing their outcome.

The user was asked to leave the failing process running and provide its launch
command, browser URL and whether it runs in WSL or Windows, without credentials.
That process/HTTP evidence is required to continue causal diagnosis.

### Actual route discovery and output paths

`frontend/package.json` runs `next dev`, `next build`, `next start` and a
sequential rendered harness. Installed Next.js is 16.3.8. `next.config.ts` exports
an empty configuration: no basePath, custom extensions/distDir, redirects or
rewrites. No middleware/proxy, route groups, Pages Router directory, competing
top-level `frontend/app` or `notFound()` call exists in authored frontend source.

`frontend/src/app/layout.tsx` has a valid default root layout, HTML/body,
AuthProvider/navigation and persistent shell. Page default exports exist for all
reported routes. `/` calls `redirect('/resources')`; sign-in/resources deliberately
return null because the shared shell owns their content. This does not itself
request a 404. Draft/history pages export headings. The shell renders role and
API failures in UI; transport lazily validates the API URL when making a request,
so missing/unavailable API configuration does not make these HTML routes absent.

Installed `next/dist/lib/find-pages-dir.js` prefers top-level `app`, then
`src/app`; the latter is the only actual app directory here. Next's installed
server config uses `.next/dev` for development and `.next` for production.
Its build cleanup explicitly preserves the `dev` child; Webpack dev cleanup is
scoped to its configured dev output. No concurrent writer was observed. There
is no evidence that the recorded production harness overwrote this dev output.

### Why prior checks passed / actionable provenance gap

The actual passing harness in `test/rendered/foundation.test.mjs` starts
`next start --hostname localhost --port 3210` from the test file's frontend
directory. It does not exercise `next dev` or live NestJS/database acceptance.
The last successful run used an isolated **Webpack production** build at
`/tmp/lessonforge-c1-correction-jvzbxn3z/frontend`, not workspace dev output.

Freshly verified: all 56 current application/public/test/configuration inputs
match that copy and manifest
`2c49d9f3aeab2e554f2476da43e694a5df7f0f77c4252ff6ea79b0454099c21f`.
Build ID `CsE1y89z-p9kEDgRuY6VJ`; its app manifest includes all feature routes,
including dynamic history. Actual prior browser log reports **99 passed**,
0 failed/skipped/cancelled, SHA-256
`60434a52fa2e834c89926b71e710a3de80ddd0eb89d8f5b858dfdd33700de712`.
These results were verified, **not rerun**. They establish that production
configuration, not the currently reported development behavior. Different mode
coverage explains why a dev-only failure could be missed; it does not prove
which mechanism caused this reported failure.

An additional concrete readiness gap: workspace `frontend/.next/BUILD_ID` is
`rdaWNWhFRqBJNpFhaAHhe`, dated October 27. Its production manifest omits new
history/admin-review routes but contains `/`, `/sign-in`, `/resources`, `/drafts`.
Using workspace `npm start` without a current build would therefore test an old
artifact. This could explain missing **new** routes if that artifact was served;
it cannot alone explain all five reported 404s, and no current process proves
that artifact was used. The previous startup guidance points at the matching
isolated production copy, not this stale workspace build.

### Source audit against backend contracts

| Concern | Actual implementation inspected |
|---|---|
| Endpoint wiring | `lesson-review-api.ts` matches `LessonWorkflowController` and `PendingReviewsController`: submit/history/exact detail/pending/exact review; strict envelopes, 201 mutations, limit 20 and ascending UUID cursors. No Next API proxy is assumed. |
| Permissions | Backend owner-filtered loads and role guards remain authoritative. UI exposes teacher draft submission and admin-only decisions; immutable GETs use workflow APIs, not administrator draft reads. Unknown targets are checked under the lesson lock before version/lifecycle conflicts. |
| Lifecycle/version | Preparation requires clean saved/reconciled draft and matching workflow version; a separate draft lock blocks save/source races. Review requires exact current SUBMITTED/unreviewed revision. Writes retain confirmed expected version; 409 needs deliberate comparison/reconciliation. |
| Immutability/snapshots | Read-only revision renderer uses returned immutable content, review and full retained source snapshots; it never fetches current resource replacements. Backend preserves history and restores draft/sources only after REQUEST_CHANGES. |
| Recovery | Submission recovery scans history from page one for baseline number + 1, reads exact detail and compares content/origin/sources even after later review/resubmission. Review recovery reads the original exact revision. No automatic write retry; missing results remain uncertain. Acknowledgement/version acceptance is explicit. |
| Session/navigation | Stores invalidate late responses through generations/abort, pause on auth uncertainty, dispose on identity/role/session replacement, preserve pending/uncertain navigation protection and comments. R1 clears incompatible history/cursors on lesson switches. |

No additional confirmed implementation defect or endpoint mismatch was found in
this source audit. This is not live authorization/concurrency/database evidence.
The known API gaps remain: no all-submitted-teacher-lesson list and no operation
status/idempotency endpoint proving an absent write failed. None explains an
unauthenticated direct HTML route returning framework 404.

### Smallest next step and verification before any correction

No application correction is justified yet; **no affected application/test file
is proposed for editing on an unproven cause**. Preserve the failing process and
capture PID/cwd/launch command plus direct HTTP headers/body for these paths and
a deliberate unknown-path control. A working `/` should redirect to resources;
other existing routes should serve the public HTML shell independently of API
availability. Distinguish an HTML Next 404 from a JSON API error or redirect.

If process evidence shows a wrong directory/stale production artifact, correct
the launch target/current artifact, not route implementation. If the problem is
isolated to development bundling, perform a sequential, separate-output
Turbopack-versus-Webpack comparison only after preserving the failing evidence
and arranging safe server ownership; a `dev --webpack` workaround would then
affect startup tooling/possibly `frontend/package.json`, not backend contracts.
Neither cause nor workaround is claimed verified here. Do not delete `.next`.

After selecting a supported correction: smoke-test root redirect, sign-in,
resources, drafts, history, known-ID history and admin reviews against the actual
intended server; verify unknown-route 404 separately. Then perform targeted
teacher/admin live acceptance using designated records and private accounts.
Run affected checks sequentially only as warranted by the eventual change;
production-only fixture passes cannot close the default-dev or live-API gap.

No build, automated suite, browser worker, install, environment-file read,
database access or system change occurred. Available memory was initially
1,466 MiB, later 1,557 MiB; swap was nearly full. Manual acceptance and causal
404 diagnosis remain pending running-server evidence.
