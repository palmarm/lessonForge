# LessonForge initial domain schema verification

## Implemented storage

The [domain design](domain-schema.md) is represented by six Prisma models, three
enums, UUID keys, `timestamptz(6)` timestamps, JSONB aggregates/snapshots, required
and nullable fields, and integer counters. Versions and generation/runtime
configuration remain unchanged at Prisma 7.10.0 with the PostgreSQL adapter.

`20261008000000_initial_domain` was generated with `migrate diff --from-empty
--to-schema ... --script` without contacting a database. The entire SQL was
reviewed: all tables and unique indexes precede the FK statements, so the circular
lesson/revision relationship is created safely. A transaction wrapper makes the
initial schema and custom protections atomic. A null current pointer allows
lesson creation before revision insertion; the composite FK rejects references
to another lesson's revision.

The tracked SQL adds positive counter checks, JSON object checks (including
rejection of JSON null), SQL-null draft/origin pairing, canonical email checking,
and nonblank change-request feedback. Update/delete triggers protect revisions,
source rows, and reviews. Another trigger makes lesson ownership and copy
provenance write-once, including null-to-value and value-to-null changes. All FKs
restrict deletion and key updates; uniqueness covers email, revision numbering,
review targets, and revision/resource pairs. Prisma generates UUIDs and maintains
`updatedAt`; direct SQL must supply those required values itself.

## Agent-run evidence

Checks used an isolated copy without real `.env` files or `DATABASE_URL`, reusing
installed dependencies. No packages were installed. No connection to
`lessonforge_dev`, migration application there, or existing Docker-volume change
was performed.

- Prisma schema validation, generation, backend build, non-mutating lint, and
  TypeScript checks passed.
- Live `test:constraints`: all 34 tests passed against PostgreSQL 17.11 in a
  newly created container on `127.0.0.1:5434/lessonforge_constraints_test`, using
  temporary storage without any development volume attached. The initial sandbox
  attempt failed preflight; the successful run used local socket permissions.
- The suite applied the actual tracked migration with `migrate deploy`, inserted
  relational fixtures with the generated client, and tested real PostgreSQL
  SQLSTATEs for invalid pointers, duplicates, invalid checks, missing/orphan
  references, restricted deletion, immutable updates/deletes, and write-once
  lesson fields. Resource update/retirement left stored source snapshots intact.
- It deliberately proved that a new source row can be inserted after submission.
  That is a documented backend responsibility, not evidence of full source-set
  immutability.

- All 80 ordinary unit tests passed on a separate rerun, including 18 new
  database-free safety-guard tests. All 7 HTTP tests passed with local socket
  permissions. The first concurrent unit run passed 79 tests and timed out in an
  existing controller-test hook; the unchanged full rerun passed.
- Authored TypeScript/config/manifest formatting passed. Documentation references,
  command consistency, and whitespace were checked.
- The agent-created disposable container was stopped after testing; its `--rm`
  container and temporary cluster storage were discarded. Existing containers
  and volumes were not stopped or altered.

These are agent-run local results. The earlier developer-confirmed GitHub run in
[CI evidence](ci.md) predates this migration change; no new GitHub run or clean
dependency installation is claimed for it.

## Agent-run review follow-up (2026-10-09)

An isolated backend copy without real `.env` files reused installed dependencies.
No packages were installed and `lessonforge_dev` was never contacted. The existing
schema and migration were unchanged.

- All **39 live constraint tests passed** against a fresh PostgreSQL 17.11
  disposable container on the existing guarded port 5434 with temporary storage
  and no development volume. This includes the five added regression cases.
- Updates to referenced `User.id`, `CurriculumResource.id`, and `Lesson.id`
  returned SQLSTATE `23503` and the exact expected FK name. The lesson fixture
  has a null current pointer, excluding its outgoing composite FK as a competing
  cause. Ownership and copy provenance remain unchanged, excluding the identity
  trigger. Full row snapshots, original keys, and references stayed intact.
- The same preflight function gates actual migration/fixture initialization and
  the live refusal cases. An already-populated target was rejected without
  initialization, and all table rows (including migration bookkeeping) and public
  object names remained unchanged. A transaction-local switch to PostgreSQL's
  built-in `pg_read_all_data` role was rejected as an identity mismatch before
  schema inspection or initialization. The original connected role was restored
  and the same snapshots remained unchanged; no alternate target was contacted.
- Backend build (including Prisma generation), non-mutating lint, TypeScript,
  all 80 ordinary unit tests, all 7 database-free HTTP tests, and changed
  TypeScript formatting passed. Relative documentation link targets and
  whitespace checks passed.
- An invocation missing the explicit test environment variables was refused by
  the URL guard before connection. Two subsequent live attempts failed during
  the bounded migration-deployment step and skipped all 39 tests. A direct
  diagnostic deployment confirmed migration application only in the disposable
  target. The final successful run used a newly created disposable container;
  no target was reset and the existing deadlines and guards were retained.
- Both containers created for this follow-up were disposed of by their exact
  IDs; their temporary storage was discarded. No pre-existing container or
  volume was stopped or altered.

The earlier 34-test evidence above remains historical. This follow-up does not
establish a new GitHub Actions run or a separate clean dependency installation.

## Developer-confirmed development verification (2026-10-09)

After the isolated implementation and review checks above, the developer reported:

- Migration `20261008000000_initial_domain` applied successfully to `lessonforge_dev`.
- Prisma migrate status reported “Database schema is up to date!”
- Backend build and compiled production startup succeeded.
- `GET /` returned HTTP 200 with body `LessonForge API`.
- Ctrl+C returned promptly to the shell.

These are developer-confirmed results, not checks independently rerun by the
agent. The historical agent evidence remains accurate: the implementation agent
did not access or migrate the development database. At that point authentication,
seeding, and workflow services remained pending; this historical run verifies
initial migration application and scaffold startup rather than implemented domain
workflows.

## Enforcement limits and pending work

NestJS still must enforce authenticated roles/ownership, authorization before
returning current content on conflict, complete lesson fields and Grade 4
Mathematics context, positive section durations and timing sums, materials rules,
trusted selection/refresh/copy snapshots, source-set completeness and no later
source inserts, latest-current-revision selection, lifecycle transitions,
approved-copy eligibility, and transactional version/race handling. JSON object
checks do not validate the complete lesson document; some fixtures intentionally
use `{}` to exercise storage rather than business validation.

FK restrictions do not prohibit deletion of every unreferenced user/resource or
draft lesson, and draft JSON resource IDs are not relational FKs. No application
hard-delete paths are planned. Row triggers do not protect against privileged
DDL, trigger disabling, or `TRUNCATE`; deployment permissions remain future work.

Backend session authentication and role guards are now implemented separately;
see [authentication verification](authentication-verification.md). Session migration
application to development, account provisioning, frontend sign-in, lesson
endpoints, ownership/lifecycle services/concurrency tests, AI, and seeding remain
pending. Development-database application was verified by the developer
on 2026-10-09. `test:db` remains the separate read-only development connectivity
check. Ordinary tests and CI remain
database-free and never invoke `test:constraints` or migrations. Follow the
[isolated procedure](development-setup.md#initial-migration-and-isolated-constraint-verification)
to reproduce real enforcement checks; do not substitute schema-text assertions
or mocked query results for this evidence.

For SQL behavior, see PostgreSQL's official
[constraint documentation](https://www.postgresql.org/docs/17/ddl-constraints.html)
and Prisma's official
[migration diff documentation](https://docs.prisma.io/docs/cli/migrate/diff).
