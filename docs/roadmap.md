# LessonForge Roadmap

## Planning approach

Work through milestones at a flexible pace.
Choose one concrete outcome for each session.
Carry unfinished tasks into the next session.

The timeline is an estimate, not a fixed deadline.
Reassess it after the manual workflow is demonstrated.

## Build sequence

1. Project setup and documentation.
2. Manual lesson creation and saving.
3. Submission, revisions, and administrator review.
4. AI drafting and validation.
5. Automated checks, containerization, and deployment.
6. Portfolio documentation and demonstration.

## Milestones

### 1. Foundation

- [x] Create the project directory and folder structure.
- [x] Install Node.js and npm inside Ubuntu using nvm.
- [x] Record the Node.js version in `.nvmrc`.
- [x] Connect VS Code to Ubuntu through WSL.
- [x] Initialize Git.
- [x] Create README and `.gitignore`.
- [x] Document the project specification and architecture.
- [ ] Commit the initial documentation.
- [ ] Create and connect the GitHub repository.
- [x] Scaffold Next.js and NestJS.
- [x] Verify both applications start locally.
- [x] Implement PostgreSQL Compose and Prisma 7 connectivity.
- [x] Verify local database health, authenticated connectivity, and Ctrl+C shutdown.
- [x] Verify incorrect-password startup, container-recreation persistence,
  real stalled-connection/query timeout behavior, and live SIGTERM shutdown.

Demonstration: both applications run locally, with a verified
backend database connection.

### 2. Manual lesson workflow

- [x] Select Grade 4 Mathematics and original fraction demonstration resources.
- [ ] Prepare the exact sample resource text during seeding.
- [x] Implement the domain models and initial migration; verify isolated constraints.
- [x] Apply the reviewed migration to the development database as a separate step.
- [ ] Create sample teacher and administrator accounts.
- [ ] Implement sign-in and backend permissions.
- [ ] Browse curriculum resources.
- [ ] Create, edit, and save lesson drafts.
- [ ] Validate lessons before submission.

Demonstration: a teacher signs in and saves a lesson,
with unauthorized edits rejected.

### 3. Review workflow

- [ ] Preserve immutable submitted revisions.
- [ ] Implement administrator review.
- [ ] Request changes with feedback.
- [ ] Revise and resubmit while retaining history.
- [ ] Approve lessons for the library.
- [ ] Copy approved lessons into new drafts.
- [ ] Verify conflicting edits and review decisions are handled safely.

Demonstration: complete the submission, feedback, resubmission, approval, and reuse workflow.

### 4. AI drafting

- [ ] Build the AI service boundary using sample responses.
- [ ] Select a provider after reviewing cost and requirements.
- [ ] Generate structured drafts from selected resources.
- [ ] Validate output and preserve source information.
- [ ] Handle failures without losing saved work.
- [ ] Add request limits and timeouts.

Demonstration: generate, edit, and submit a lesson draft.

### 5. Delivery

- [ ] Containerize the applications.
- [x] Implement checks, tests, and builds with GitHub Actions.
- [x] Verify the first GitHub Actions run and configure required checks on staging and main.
- [ ] Choose hosting.
- [ ] Configure deployment and database migrations.
- [ ] Add health checks and useful logs.
- [ ] Verify the deployed workflow.

Demonstration: use the application through a hosted URL.

### 6. Portfolio

- [ ] Complete setup and deployment instructions.
- [ ] Explain architecture decisions and tradeoffs.
- [ ] Record a short demonstration.
- [ ] Document lessons learned and remaining limitations.


## Session notes

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
  authentication, and backend permissions.
