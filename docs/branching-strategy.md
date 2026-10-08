# Branching Strategy

## Permanent branches

- staging: integration branch for verified development work.
- main: release branch.

All changes enter these branches through pull requests.
Direct pushes, force pushes, and branch deletion are blocked
by branch protection, including for administrators.

## Task branches

Create focused task branches from the latest staging.

| Prefix | Purpose | Example |
|---|---|---|
| feat/ | New functionality | feat/application-setup |
| fix/ | Bug fixes | fix/lesson-ownership-check |
| docs/ | Documentation | docs/branching-strategy |
| refactor/ | Internal restructuring | refactor/review-service |
| chore/ | Tooling and maintenance | chore/ci-checks |
| test/ | Test coverage | test/review-concurrency |

With a clean working tree:

    git switch staging
    git pull --ff-only
    git switch -c <branch-name>

Inspect and preserve uncommitted work before switching branches.

## Development PRs

1. Create a task branch from staging.
2. Open a PR targeting staging.
3. Review the complete diff and run appropriate checks.
4. Resolve actionable findings and review conversations.
5. Squash merge into staging.
6. Delete the task branch after confirming the merge.

No external reviewer approval is required for this solo project.

PR descriptions explain the change and actual verification results.
Never report checks as passed unless they ran successfully.

## Release PRs

1. Open a release PR from staging into main.
2. Review the release changes and verification results.
3. Resolve actionable findings and conversations.
4. Merge using a merge commit.
5. Tag the resulting main commit, for example v0.1.0.
6. Open a synchronization PR from main into staging and merge
   using a merge commit.

Do not squash recurring release or synchronization PRs.
Merge commits preserve shared ancestry between permanent branches.

## Branch protection

Both main and staging require:
- Pull requests before merging.
- Resolution of review conversations.
- Enforcement for administrators.
- Force pushes and branch deletion blocked.

Required reviewer approvals are disabled.
Linear history is not required because release PRs use merge commits.

The [CI workflow](ci.md) defines stable checks named `Frontend checks` and
`Backend checks` for PRs targeting `staging` and `main`, pushes to those branches,
and manual dispatch. Both checks appear without path filters.

These checks are not yet configured as required by branch protection. First
verify an actual GitHub Actions run, then configure the required checks separately.
Until then, distinguish local verification from workflow-run evidence in PRs.

## After a task PR is merged

    git switch staging
    git pull --ff-only

Confirm the task's changes are present before deleting its local branch.

Squash merging may cause git branch -d to refuse deletion.
Use git branch -D only after confirming the work was merged
and no uncommitted work remains.

## Agent actions

Agents must not commit, push, merge, tag, or deploy unless requested.
