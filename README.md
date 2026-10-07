# LessonForge

An AI-assisted lesson-planning application built as a portfolio and learning project.

## Purpose

Help teachers create lesson plans from sample curriculum resources,
revise their drafts, and submit them for administrator review.

The project develops practical skills in full-stack TypeScript, database design, AI integration, testing, and DevOps.

## MVP scope

The first version supports one fictional school, one subject,
and one grade level, using sample learning materials.

- Sign in as a teacher or administrator.
- Browse administrator-managed curriculum resources.
- Create, edit, and save lesson drafts.
- Submit a lesson revision for review.
- Approve a submission or request changes with feedback.
- Browse approved lessons and copy one into a new draft.
- Generate editable AI drafts from selected resources.
- Preserve submitted revisions and review decisions.

Teachers review AI-generated content before submission.
AI cannot approve or publish lessons.

Publication means inclusion in the application's approved lesson library.
Sample materials do not imply official curriculum alignment.

## Technology stack

- Frontend: Next.js and TypeScript
- Styling: Tailwind CSS v4 via its PostCSS plugin
- Backend: NestJS and TypeScript
- Database: PostgreSQL
- Database access and migrations: Prisma ORM
- Local infrastructure: Docker Compose
- CI/CD: GitHub Actions
- AI provider and hosting: to be selected later

NestJS owns business rules, authorization, and database access.
Next.js provides the user interface and communicates with the backend.
Prisma runs within the backend.

## Repository structure

- `frontend/` — Next.js application
- `backend/` — NestJS application and Prisma
- `docs/` — setup, specification, architecture, roadmap, and verification guides

## Current status

Next.js with Tailwind CSS and the NestJS ESM API are scaffolded. PostgreSQL Compose
and Prisma 7 connectivity are implemented and verified locally, including startup,
failure paths, persistence, timeouts, and shutdown. The developer also verified
frontend styling and its Turbopack build.
See `docs/database-foundation-verification.md`
for the evidence and check results. Domain schema design, authentication, lesson
workflows, AI, and CI remain later tasks.

## Quick start

From the repository root, select Node with `nvm use` and follow the
`docs/development-setup.md` to install dependencies,
create and fill ignored environment files, and start PostgreSQL on
`127.0.0.1:5433`. Then run the applications in separate terminals:

```bash
npm run dev --prefix frontend
```

```bash
npm run start:dev --prefix backend
```

Frontend: `http://localhost:3000`. API: `http://localhost:3001` (`GET /` returns
`LessonForge API`). Stop either application with Ctrl+C.

## Deferred features

Semantic search, document uploads, student accounts, multiple schools,
and PDF export are outside the initial MVP.

## Documentation

- `docs/development-setup.md` — local setup and troubleshooting.
- `docs/project-specification.md` — product scope, workflows, and acceptance criteria.
- `docs/architecture.md` — stack, application responsibilities, and design.
- `docs/roadmap.md` — milestones and next tasks.
- `docs/branching-strategy.md` — branches and pull-request workflow.
- `docs/database-foundation-verification.md` — verification evidence.
