# LessonForge Roadmap

## Planning approach

Work through milestones at a flexible pace.
Choose one concrete outcome for each session.
Carry unfinished tasks into the next session.

Reassess the remaining work after each working demonstration. There are no fixed
dates or weekly-hour commitments.

## Build sequence

The developer-approved sequence after the foundation is:

1. Curriculum resource management and teacher browsing.
2. Teacher drafts, resource selection/snapshots, saving, and validation.
3. Submission, review, resubmission, approved library, and copying.
4. First restricted staging deployment of the complete manual workflow.
5. AI drafting, followed by deployment of that addition.
6. Portfolio demonstration and documentation.

AI remains part of the intended MVP. The first restricted staging deployment is
an intermediate milestone, not completion of the full MVP. Containerization,
hosting evaluation, and deployment preparation may proceed alongside feature
development; releasing the manual workflow waits for its completion and the
staging prerequisites below. Add automated checks throughout development.

## Milestones

### Foundation

- [x] Create the project directory and folder structure.
- [x] Install Node.js and npm inside Ubuntu using nvm.
- [x] Record the Node.js version in `.nvmrc`.
- [x] Connect VS Code to Ubuntu through WSL.
- [x] Initialize Git.
- [x] Create README and `.gitignore`.
- [x] Document the project specification and architecture.
- [x] Commit the initial documentation.
- [x] Create and connect the GitHub repository.
- [x] Scaffold Next.js and NestJS.
- [x] Verify both applications start locally.
- [x] Implement PostgreSQL Compose and Prisma 7 connectivity.
- [x] Verify local database health, authenticated connectivity, and Ctrl+C shutdown.
- [x] Verify incorrect-password startup, container-recreation persistence,
  real stalled-connection/query timeout behavior, and live SIGTERM shutdown.
- [x] Select Grade 4 Mathematics and original fraction demonstration resources.
- [x] Implement the domain models and initial migration; verify isolated constraints.
- [x] Apply the reviewed migration to the development database as a separate step.
- [x] Provision teacher and administrator accounts; unchanged repeat invocation confirmed (developer 2026-10-13).
- [x] Implement backend sessions, login/me/logout, and authentication/role guards.
- [x] Apply the additive Session migration to the development database (developer confirmed 2026-10-13).
- [x] Implement safe local account provisioning.
- [x] Run compiled local account provisioning on `lessonforge_dev`; repeat invocation left both accounts unchanged (developer confirmed 2026-10-13).
- [x] Implement frontend login/logout and current-user handling.
- [x] Verify teacher/admin browser login, refresh, logout, and incorrect-password rejection (developer confirmed 2026-10-14).
- [x] Verify browser API-outage recovery (developer confirmed separately; see [frontend verification](frontend-authentication-verification.md#confirmed-browser-outage-recovery)).
- [ ] Verify cookie attributes, CORS/CSRF, HTTPS, component rendering, and keyboard/screen-reader interaction; outage confirmation does not establish these checks.
- [x] Implement checks, tests, and builds with GitHub Actions.
- [x] Verify the first GitHub Actions run and configure required checks on staging and main.

Demonstration: both applications run locally with a verified backend database
connection and confirmed basic browser authentication and outage recovery.
Remaining verification is tracked separately from these confirmed results.

### 1. Curriculum resources

- [ ] Prepare the exact original sample resource text during seeding.
- [ ] Implement administrator resource creation, updates, and retirement.
- [ ] Enforce resource permissions and runtime validation in NestJS.
- [ ] Implement teacher browsing of active curriculum resources.
- [ ] Verify unauthorized resource changes are rejected.

Demonstration: an administrator manages resources and a teacher browses the
available demonstration material.

### 2. Teacher drafts

- [ ] Implement transaction-time lesson ownership and workflow permissions.
- [ ] Select resources and capture trusted snapshots in NestJS.
- [ ] Preserve snapshots on ordinary saves; allow explicit refresh only from an active resource.
- [ ] Create, edit, and save incomplete manual drafts.
- [ ] Implement backend submission validation, including required fields and section timings.
- [ ] Verify conflicting saves cannot silently overwrite work.

Demonstration: a teacher selects resources and saves a draft, with unauthorized
edits rejected and validation feedback available before submission.

### 3. Review and approved library

- [ ] Submit validated lessons and preserve immutable submitted revisions and source snapshots.
- [ ] Implement administrator review of the exact submitted revision.
- [ ] Request changes with feedback.
- [ ] Revise and resubmit while retaining history.
- [ ] Approve lessons for the library.
- [ ] Browse approved lessons and copy them into new teacher-owned drafts with retained source snapshots.
- [ ] Verify conflicting edits and review decisions are handled safely.
- [ ] Verify the complete manual workflow, including permissions and failure cases.

Demonstration: complete submission, feedback, resubmission, approval, browsing,
and copying without AI. Only an administrator can approve for the library.

### 4. First restricted staging deployment

Preparation can proceed alongside milestones 1–3. All prerequisites below remain
pending and must be verified before restricted staging access is opened:

- [ ] Containerize the applications and choose hosting and an access restriction for designated testers.
- [ ] Configure HTTPS and same-site frontend/API origins; verify Secure host-only cookies,
  credentialed CORS, CSRF rejection, and session behavior in the deployed browser.
- [ ] Configure trusted proxy/ingress handling and shared/edge rate limits appropriate
  to the deployment topology; verify limits and benchmark password hashing on the host.
- [ ] Configure session expiry and an hourly cleanup scheduler for the deployment;
  verify login, refresh, expiry, logout, and outage recovery there.
- [ ] Use a least-privilege runtime database role, separate from the migration/owner role;
  verify the runtime role cannot bypass immutable content protections via DDL or TRUNCATE.
- [ ] Provision secrets securely, separate staging configuration/data from local development,
  and verify no secrets or sensitive lesson/session content appear in logs.
- [ ] Document and rehearse reviewed migration deployment, release ordering, and failure recovery;
  do not reset shared databases or modify applied migrations.
- [ ] Configure backups and verify restoration into a separate database.
- [ ] Add useful sanitized logs, health/readiness checks, and an operational failure response procedure.
- [ ] Verify the complete deployed manual workflow with teacher and administrator accounts,
  including permissions, validation, concurrency, preserved history, and copying.
- [ ] Record deployment configuration, verification evidence, and remaining limitations.

Demonstration: designated testers use the complete manual workflow through a
restricted HTTPS staging URL. This is not full MVP completion or evidence of
public production readiness. Public access requires a separate readiness review
of security, operations, capacity, and unresolved verification gaps before release.

### 5. AI drafting and deployment

- [ ] Build the AI service boundary using sample responses.
- [ ] Select a provider after reviewing cost and requirements.
- [ ] Generate structured drafts from selected resources.
- [ ] Validate untrusted output and preserve source information and AI origin.
- [ ] Handle failures without losing saved work or blocking manual continuation.
- [ ] Add generation request limits and timeouts.
- [ ] Verify teachers can edit and submit AI drafts through the same manual approval workflow;
  AI must never approve or publish lessons.
- [ ] Deploy the AI addition to restricted staging with backend-only provider secrets
  and verify generation, failure handling, and the existing manual workflow there.

Demonstration: generate, edit, save, and submit a lesson draft on restricted staging,
then obtain administrator review. AI is required for the full MVP acceptance criteria.

### 6. Portfolio

- [ ] Complete setup and deployment instructions.
- [ ] Explain architecture decisions and tradeoffs.
- [ ] Record a short demonstration covering the manual workflow and AI drafting.
- [ ] Document lessons learned, verification evidence, access restrictions, and remaining limitations.
- [ ] Check all [MVP acceptance criteria](project-specification.md#9-acceptance-criteria),
  including the deployed AI addition, before declaring MVP completion.

## Session notes

The earlier next-task notes below are historical. The current next feature task is
curriculum resource management and teacher browsing (milestone 1); infrastructure
preparation may proceed alongside it.

At the end of each session, record:

- What was completed.
- What was learned.
- Verification results.
- The next task.

### Application setup verification

This records the earlier scaffold session. Current database-foundation evidence
is in the [verification guide](database-foundation-verification.md).

- Next.js with Tailwind CSS displays the LessonForge heading on port 3000.
  The developer verified browser styling and a successful Turbopack production
  build, including TypeScript checking and static page generation.
- NestJS uses ESM and serves `LessonForge API` from `GET /` on port 3001.
  Optional shell `PORT` overrides are validated before startup; environment files
  are not loaded automatically.
- Backend lint, TypeScript checking, build, 15 unit tests, and 1 end-to-end test
  passed. The compiled API's default-port HTTP smoke check also passed.
- The sandbox initially blocked the end-to-end test's local port binding with
  `EPERM`; the test passed when rerun outside the sandbox. The API smoke check
  also ran outside the sandbox and stopped its process after verification.
- The repository scan found only the root `.git`, pruning `node_modules`.
- Next task: PostgreSQL and Prisma setup. The full foundation demonstration
  remains incomplete until a database connection is verified.

### Database foundation

Implementation, shutdown investigation, and developer/agent verification records
are in the [database-foundation verification guide](database-foundation-verification.md).
All previously recorded database-foundation evidence gaps have been closed.
Use the [development setup guide](development-setup.md) for current commands.
Next task: select the sample subject, grade, and resources, then design the domain
schema before creating the first migration.

That next-task note records the database-foundation session. The context is now
confirmed and the initial storage implementation is recorded below.

### GitHub Actions CI

- Added independent `Frontend checks` and `Backend checks` jobs for PRs targeting
  `staging` and `main`, pushes to those branches, and manual dispatch.
- Both jobs use Ubuntu 24.04, Node from `.nvmrc`, locked npm installation, and
  application-specific npm download caching. Actions are pinned to verified
  release commits. Backend checks use no database or real environment files.
- Initial agent verification passed frontend lint and type checking, backend
  generation, build, lint, type checking, 62 unit tests, and 7 HTTP tests. The local
  frontend build was blocked by network and port-binding restrictions; HTTP tests
  passed after a retry with expanded local socket permissions. This historical
  evidence remains in [CI documentation](ci.md).
- The developer subsequently confirmed `Frontend checks` and `Backend checks`
  passed on GitHub and the CI PR was merged into `staging`.
- The developer confirmed both `staging` and `main` require those checks to pass
  and branches to be up to date before merging. Reviewer approval remains disabled
  for solo development.
- `actionlint` and a separate local clean installation remain unverified. The
  successful GitHub run is separate evidence from the earlier local restrictions.
  See the CI guide for commands, limitations, and troubleshooting.

### Initial domain models and migration

- Implemented six domain models, the composite current-revision FK, restricted
  deletion, and SQL checks/immutable-row/write-once triggers.
- Generated the migration offline and verified deployment and constraints in a
  separate disposable PostgreSQL database; see
  [verification evidence](domain-schema-verification.md) for results and limits.
- Historical implementation-agent evidence: the development database was not
  contacted or migrated; verification used only disposable targets.
- On 2026-10-09, the developer confirmed `20261008000000_initial_domain` applied
  successfully to `lessonforge_dev` and Prisma migrate status reported
  “Database schema is up to date!” Backend build and compiled production startup
  succeeded; `GET /` returned HTTP 200 with body `LessonForge API`, and Ctrl+C
  returned promptly to the shell.
- Authentication, lesson endpoints, lifecycle transactions, AI, and
  account/resource seeding remain pending. Next: implement setup-created accounts,
  authentication, and backend permissions. This records the historical domain
  milestone; current backend authentication status is below.

## Authentication implementation

Steps 1–3 of [authentication design](authentication-design.md) are implemented.
[Authentication verification](authentication-verification.md) distinguishes local
checks from earlier GitHub results. The applied domain migration is unchanged.
The developer confirmed both migrations, connectivity, compiled startup, root/me
responses, prompt shutdown, session cleanup, and an unchanged compiled provisioning
rerun on `lessonforge_dev` on 2026-10-13. Frontend login/logout and current-user
handling were implemented on 2026-10-14; the developer confirmed teacher/admin
browser login, refresh, logout, and incorrect-password rejection that day. See
[frontend verification](frontend-authentication-verification.md) for automated
checks and the manual browser checklist. The developer separately confirmed browser
API-outage recovery; cookie, CORS/CSRF, HTTPS, component-rendering, and accessibility
checks remain unverified. See the separate confirmation in that guide. Staging
prerequisites remain pending.
