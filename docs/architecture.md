# LessonForge Architecture

## Status

Initial architecture decision.
Applications have not yet been scaffolded.

## 1. Technology choices

| Area | Choice |
|---|---|
| Frontend | Next.js with TypeScript |
| Backend | NestJS with TypeScript |
| Database | PostgreSQL |
| Database access and migrations | Prisma ORM |
| Package manager | npm |
| Local infrastructure | Docker Compose |
| Automation | GitHub Actions |
| AI provider | Selected at the AI milestone |
| Hosting | Selected at the deployment milestone |

The Node.js version is recorded in the root `.nvmrc`.
Framework and dependency versions will be recorded during scaffolding.
Package lock files will be committed.

## 2. Application responsibilities

### Next.js frontend

- Display sign-in, dashboard, resource, editor, review, and library pages.
- Manage form interactions and show validation feedback.
- Communicate with the NestJS API.
- Display loading, success, and error states.
- Use Server and Client Components where appropriate.

Frontend checks improve usability.
They do not replace backend authorization or validation.

### NestJS backend

- Authenticate users and enforce roles and lesson ownership.
- Validate requests.
- Manage lesson saving, submission, revisions, and reviews.
- Manage curriculum resources.
- Coordinate database transactions.
- Call the AI provider and validate generated content.
- Return consistent API errors.

Organize the backend into feature modules:
authentication, users, resources, lessons, reviews, and AI.

Controllers handle HTTP requests.
Services implement business rules.
Database access is provided through a dedicated Prisma service.

### PostgreSQL and Prisma

PostgreSQL stores application data and enforces database constraints.

Prisma provides database access and schema migration tooling.
Only the NestJS backend connects to the database.

Migration files are reviewed and committed.
Production schema changes use the migration deployment process for the selected Prisma version.

Prisma does not replace authorization, runtime validation,
transaction design, or concurrency controls.

## 3. Request flow

A typical save request follows this sequence:

1. The teacher edits a lesson in Next.js.
2. Next.js sends a request to the NestJS API.
3. NestJS authenticates the user and checks ownership.
4. NestJS validates the request and applies workflow rules.
5. Prisma executes the database operations.
6. NestJS returns the result.
7. Next.js updates the interface.

Next.js does not implement a second copy of lesson business rules.
Any server-side forwarding or rendering must preserve the user's authenticated context when calling NestJS.

## 4. Authentication boundary

Authentication is owned by NestJS.

The intended approach is server-side sessions with an HttpOnly cookie.
Session storage and implementation details will be selected before building authentication.

Protected operations require backend role and ownership checks.

Deployment must account for cookie settings, HTTPS, CSRF protection, and the relationship between frontend and API origins.

## 5. Data integrity

- Submitted revisions and approved content remain immutable.
- Reviews refer to the exact submitted revision.
- Related submission and review changes execute atomically.
- Concurrent edits and decisions must be detected or serialized.
- Database constraints support application rules.
- Resource changes preserve historical source information.

Detailed constraints and concurrency mechanisms will be documented with the database design.

## 6. AI boundary

The frontend requests generation through NestJS.
NestJS calls the selected provider through an AI service adapter.

- Provider credentials remain on the backend.
- Generated content is validated before acceptance.
- AI output is treated as untrusted draft content.
- Generation cannot approve or publish a lesson.
- Failed generation preserves existing saved work.
- Request limits and timeouts will be added at the AI milestone.

Start development with sample responses before paid API calls.

## 7. Local development

Use Ubuntu through WSL and VS Code's WSL connection.

Initially:
- Run Next.js and NestJS directly in Ubuntu.
- Run PostgreSQL through Docker Compose.
- Use separate development ports for frontend and backend.

Configure ports and API origins explicitly during scaffolding.
Application containers will be introduced after the basic workflow works.

## 8. Configuration

- Record configuration names in `.env.example` files.
- Keep real credentials in ignored local environment files.
- Treat variables exposed to browser code as public.
- Keep database credentials, session secrets, and AI keys on the backend.
- Validate required backend configuration at startup.

## 9. Verification and delivery

Add checks incrementally:

- Type checking and linting.
- Backend business-rule and permission tests.
- PostgreSQL integration tests for critical data behavior.
- Browser tests for the main teacher and administrator workflow.
- Build checks in GitHub Actions.

Deployment will include an explicit migration step, health checks, and useful logs without credentials or sensitive content.

## 10. Repository layout

- frontend/ — Next.js application.
- backend/ — NestJS application, Prisma schema, and migrations.
- docs/ — specification, architecture, roadmap, and later design decisions.

Keep one Git repository at the project root.
Avoid nested Git repositories when scaffolding applications.