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

Application setup commands will be added after scaffolding.

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

Development environment and repository initialized.
Application scaffolding has not started.