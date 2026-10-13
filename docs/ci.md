# LessonForge CI

## Workflow coverage

`.github/workflows/ci.yml` defines `LessonForge CI` with independent jobs named
`Frontend checks` and `Backend checks`. Keep these names stable so they can be
used by the required-check rules for `staging` and `main`.

The workflow runs on pull requests targeting `staging` or `main`, pushes to either
branch, and manual `workflow_dispatch`. It has no path filters, so documentation
changes also create both checks. It uses `pull_request`, not `pull_request_target`.
Feature-branch pushes alone do not trigger it; open a PR to a covered target.
Manual dispatch becomes available once the workflow exists on the default branch.
See GitHub's [workflow event documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch).

Both jobs use `ubuntu-24.04` and read Node's exact version from root `.nvmrc`.
The frontend timeout is 20 minutes; the backend timeout is 15 minutes. The workflow
grants only `contents: read`, and checkout does not persist authentication.
No repository secrets or database credentials are configured.

Concurrency groups combine the workflow name with the PR number or branch ref.
A newer run cancels older queued or running work for that same PR or branch;
different PRs and branches remain independent. Manual runs share the branch group
with pushes. See GitHub's [concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

## Actions and dependency installation

Actions are pinned to full commit SHAs with release-version comments. The current
official releases were checked on 2026-10-08:

| Action | Release | Commit |
|---|---|---|
| `actions/checkout` | [v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | [v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0) | `949feb2413d6458794dcd2491c4babbbce0c15c1` |

When updating an action, verify the release's commit in its official repository
and update both the full SHA and version comment.

Each job runs `npm ci` in its own application directory. `setup-node` caches npm
downloads using `frontend/package-lock.json` or `backend/package-lock.json` for
that job. It does not cache `node_modules`; even a cache hit still runs `npm ci`.
The jobs install development dependencies because lint, types, tests, and builds
need them. The repository has no root npm manifest or shared root lockfile.

## Commands and order

After `npm ci`, `Frontend checks` runs from `frontend/`:

```bash
npm run lint
npm run typecheck
npm run build
```

`typecheck` generates Next.js route types before TypeScript checks. The existing
production build uses Turbopack and fetches Google Fonts when uncached.

After `npm ci`, `Backend checks` runs from `backend/`:

```bash
npm run build
npm run lint
./node_modules/.bin/tsc --noEmit
npm test
npm run test:e2e
```

The backend build runs first because its existing `prebuild` lifecycle script
runs `prisma:generate`. This generates the domain client before lint, type
checks, or tests import it. There is no separate generation step or second build.
The type check uses the installed TypeScript binary because the backend has no
`typecheck` npm script. Lint does not auto-fix; `npm test` uses `vitest run`, and
`test:e2e` also runs once rather than watching.

## Database-free scope and limitations

A fresh checkout contains no real `.env` files. Prisma configuration tolerates a
missing `backend/.env`; generation requires no database URL. Unit tests use fakes,
and HTTP tests replace database access and mock environment loading where needed.
No PostgreSQL service, repository secrets, or real credentials are needed.

The workflow never invokes `test:db`, `test:constraints`, `test:auth:db`, session
cleanup, migrations, Docker Compose, API startup, or deployment. HTTP end-to-end
tests cover the scaffold, real authentication/role guards, cookie handling,
exact-origin CORS/CSRF, rate limits, and shutdown with substituted database access.
Unit tests include real native Argon2 hash/verify. They do not prove live database
connectivity or domain workflows. Live database evidence remains in the
[database-foundation verification guide](database-foundation-verification.md).
Initial domain migration enforcement is checked separately against a disposable
database; see [domain verification](domain-schema-verification.md). Generation
with models still requires no database URL or live PostgreSQL service.

Dependency installation, Node setup, Prisma engine availability, and uncached
Google Fonts builds need network access. npm caching reduces downloads but does
not guarantee offline execution. The developer confirmed that both jobs passed
on GitHub, including their `npm ci` steps. This does not establish offline support
or a separate local clean-install verification.

## Local verification and GitHub evidence

Agent checks on 2026-10-08 used an isolated copy of tracked application files and
existing installed dependencies, with no real `.env` files or `DATABASE_URL`:

- Frontend lint and type checking passed.
- Backend Prisma generation, production build, non-mutating lint, type checking,
  and all 62 unit tests passed.
- Frontend production build was blocked: the initial attempt could not fetch
  Google Fonts; a retry with expanded permissions reached a Turbopack port-bind
  failure (`Operation not permitted`). The production build remains enabled in CI.
- All 7 HTTP tests passed after a retry with expanded local socket permissions.
  The initial attempt was blocked by `listen EPERM`.
- YAML parsing and explicit workflow-structure validation checked event coverage,
  permissions, concurrency, stable names, runners, timeouts, action pins, caching,
  shell syntax, and commands against both manifests and lockfiles. Documentation
  references and whitespace were checked. `actionlint` was unavailable.

These historical local results are separate from the later successful GitHub
Actions run. The local frontend build restrictions remain part of that record;
`actionlint` and a separate local clean `npm ci` were not verified.

The developer subsequently confirmed:

- `Frontend checks` and `Backend checks` passed on GitHub.
- The CI PR was merged into `staging`.
- Both `staging` and `main` now require those checks to pass and branches to be
  up to date before merging.
- Required reviewer approval remains disabled for solo development.

These GitHub results and protection settings are developer-confirmed, rather than
independently inspected by the agent. See the [branching strategy](branching-strategy.md).

To verify clean dependency installation yourself, run from the repository root:

```bash
nvm use
npm ci --prefix frontend
npm ci --prefix backend
```

These commands replace each application's `node_modules` with locked dependencies
and require network access. Use a fresh checkout without real `.env` files when
reproducing CI's environment, then run the application commands listed above.
The agent does not run dependency installation commands for this task.

## Troubleshooting

- If `npm ci` rejects a lockfile, compare that application's manifest and lockfile.
  Resolve the mismatch locally and review both files; keep `npm ci` in CI.
- If Prisma imports are missing locally, run the backend build before checks.
  Its `prebuild` generates the client; do not add redundant generation to CI.
- If HTTP tests fail with `EPERM` while listening locally, the execution sandbox
  may prohibit local sockets. Run the unchanged tests where listeners are allowed;
  do not skip them in CI or add a database service.
- If the frontend build cannot fetch Google Fonts, check runner/network access.
  A blocked local network does not establish a code failure or justify replacing
  the production build command.
- If a workflow is canceled, inspect the newer run for the same PR or branch.
  Cancellation is expected when a new revision supersedes earlier work.
- If a check is missing, confirm the PR targets `staging` or `main`, inspect Actions
  policy/approval requirements for the repository, and verify the workflow exists
  on the relevant revision. Manual dispatch additionally needs the workflow on
  the default branch. Both protected branches require the two stable checks;
  a missing check or an out-of-date branch can block merging.
- If action pins are rejected, verify repository/organization Actions policy
  allows the official actions and confirm the SHA against the linked release.

See the [development setup guide](development-setup.md#checks) for local application
checks and environment setup outside CI.

## Backend authentication coverage

The Session migration and PostgreSQL locking/expiry/rotation/race/cleanup behavior
are checked only by the explicit disposable `test:auth:db` suite. Ordinary checks
remain database-free and use no credentials/secrets. No workflow command changed.
See [authentication verification](authentication-verification.md) for current
local evidence. The developer-confirmed GitHub run above predates this change;
a GitHub run including the new authentication tests has not yet been reported.
No separate clean `npm ci` or actionlint result is claimed.
