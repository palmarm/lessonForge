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

- frontend/ — Next.js application
- backend/ — NestJS application and Prisma
- docs/ — specification, architecture, and roadmap

## Development environment

Development takes place in Ubuntu through WSL, using VS Code.

Select the project's Node.js version:

    nvm use

The required version is recorded in `.nvmrc`.

Each application has its own npm manifest and lockfile. From the repository root,
install the locked dependencies (on a fresh checkout):

```bash
npm ci --prefix frontend
npm ci --prefix backend
```

These commands install dependencies into each application's `node_modules/`.
They do not initialize Git repositories. No database is required for the starter apps.

Run the applications in separate terminals from the repository root:

```bash
npm run dev --prefix frontend
```

Next.js serves the Tailwind-styled LessonForge page at `http://localhost:3000`.

```bash
npm run start:dev --prefix backend
```

NestJS serves `GET /` at `http://localhost:3001`, returning `LessonForge API`.
Both development commands watch for source changes; stop them with Ctrl+C.

The backend defaults to port `3001`. Override it through the shell, for example:

```bash
PORT=3002 npm run start:dev --prefix backend
```

`PORT` must be a decimal integer from `1` to `65535`; invalid values stop startup.
`backend/.env.example` documents the setting. The current backend does **not**
automatically load `.env` files: copying the example to `.env` alone has no effect.

Run frontend verification from `frontend/`:

```bash
npm run lint
npm run typecheck
npm run build
```

Run backend verification from `backend/`:

```bash
npm run lint
./node_modules/.bin/tsc --noEmit
npm run build
npm test
npm run test:e2e
```

Lint checks source without auto-fixing files. Frontend `typecheck` generates Next.js
route types before running TypeScript, so it works before the first development
server or build. Type checks do not emit JavaScript.
Builds generate `.next/` for the frontend and `dist/` for the backend.
Backend tests run once: `npm test` runs unit tests, and `test:e2e` exercises the HTTP
endpoint. End-to-end tests require permission to bind a local port. The frontend
build's existing Google Fonts integration requires network access on an uncached build.

## Build sequence

1. Project setup and documentation.
2. Manual lesson creation and saving.
3. Submission, revisions, and administrator review.
4. AI drafting and validation.
5. Automated checks, containerization, and deployment.
6. Portfolio documentation and demonstration.

## Deferred features

Semantic search, document uploads, student accounts, multiple schools,
and PDF export are outside the initial MVP.


## Current status

Next.js with Tailwind CSS and the NestJS ESM API are scaffolded.
The developer verified frontend styling on port 3000 and its Turbopack build.
Backend lint, type checks, build, unit tests, end-to-end tests, and a default-port
HTTP smoke check passed. HTTP checks required execution outside the sandbox.
PostgreSQL, Prisma, authentication, AI, and CI implementation remain for later tasks.
