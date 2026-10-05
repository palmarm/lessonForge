# LessonForge Roadmap

## Planning approach

Work through milestones at a flexible pace.
Choose one concrete outcome for each session.
Carry unfinished tasks into the next session.

The timeline is an estimate, not a fixed deadline.
Reassess it after the manual workflow is demonstrated.

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
- [ ] Set up PostgreSQL and Prisma.

Demonstration: both applications run locally, with a verified
backend database connection.

### 2. Manual lesson workflow

- [ ] Select the sample subject, grade, and resources.
- [ ] Design the database schema and initial migration.
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
- [ ] Automate checks, tests, and builds with GitHub Actions.
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
