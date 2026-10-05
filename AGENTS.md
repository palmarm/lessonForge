# Agent Instructions

## Project scope

LessonForge is an AI-assisted lesson-planning application.

Follow:
- README.md
- docs/project-specification.md
- docs/architecture.md
- docs/roadmap.md
- docs/branching-strategy.md


Keep documentation and implementation specific to LessonForge.
Do not introduce references or dependencies on unrelated projects.

## Stack and architecture

- Frontend: Next.js with TypeScript.
- Backend: NestJS with TypeScript.
- Database: PostgreSQL.
- Database access and migrations: Prisma ORM.
- Package manager: npm.

NestJS owns authentication, authorization, business rules,
database access, and AI provider integration.

Next.js provides the interface and communicates with NestJS.
Do not duplicate business rules in the frontend.
Keep Prisma and private credentials in the backend.

Maintain one Git repository at the project root.

## Collaboration and explanations

- Work on one clearly scoped task at a time.
- Explain commands before asking the developer to execute them.
- Describe what each command changes and its expected result.
- Explain unfamiliar concepts using practical examples.
- Prefer small, reviewable changes.
- Ask for clarification when an unresolved product decision materially affects implementation.

## Implementation rules

- Inspect relevant files before editing.
- Follow existing conventions.
- Keep changes within the requested scope.
- Do not overwrite unrelated or uncommitted work.
- Avoid unnecessary dependencies and abstractions.
- Enforce permissions and runtime validation in the backend.
- Preserve submitted revisions and approved content.
- Handle conflicting updates without silent data loss.
- Treat AI output as untrusted draft content.
- AI must never approve or publish lessons.

## Database and configuration

- Review and commit migration files.
- Do not modify migrations already applied to shared environments.
- Do not reset or delete a database without explicit authorization.
- Keep real credentials out of source code, logs, and documentation.
- Provide configuration examples without real secrets.
- Commit package lock files.

## Verification

- Run checks appropriate to the change.
- Test meaningful business rules and failure cases.
- Report which checks ran and their results.
- Clearly identify checks that could not be run.
- Never claim successful verification without evidence.
- Update documentation when behavior or setup changes.

## Git

- Use clear, descriptive commit messages.
- Review staged changes before committing.
- Do not commit, push, merge, or deploy unless requested.