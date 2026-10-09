import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { createDatabaseClient } from '../src/prisma/prisma.service.js';
import { initializeConstraintDatabase } from './support/constraint-preflight.js';
import { resolveConstraintDatabaseUrl } from './support/constraint-database.js';

const exec = promisify(execFile);
let db: PrismaClient | undefined;
const ids = {
  teacher: randomUUID(),
  admin: randomUUID(),
  otherTeacher: randomUUID(),
  resource: randomUUID(),
  otherResource: randomUUID(),
  lesson: randomUUID(),
  otherLesson: randomUUID(),
  revision: randomUUID(),
  otherRevision: randomUUID(),
  review: randomUUID(),
};

function client(): PrismaClient {
  if (!db) throw new Error('Disposable database setup did not complete.');
  return db;
}

// Check PostgreSQL's real SQLSTATE, never matched error prose or mocked results.
// Do not expose connection strings or original driver errors in failing assertions.
async function rejectsSql(
  sql: string,
  values: unknown[],
  expectedCode: string,
  expectedConstraint?: string,
): Promise<void> {
  let code: unknown = 'query unexpectedly succeeded';
  let constraint: string | undefined;
  try {
    await client().$executeRawUnsafe(sql, ...values);
  } catch (error) {
    const meta = (error as { meta?: Record<string, unknown> }).meta;
    const driver = meta?.driverAdapterError as
      | { cause?: { originalCode?: string; constraint?: { index?: string } } }
      | undefined;
    constraint = driver?.cause?.constraint?.index;
    code = driver?.cause?.originalCode ?? meta?.code ?? 'no SQLSTATE returned';
  }
  expect(code).toBe(expectedCode);
  if (expectedConstraint) expect(constraint).toBe(expectedConstraint);
}

beforeAll(async () => {
  const url = resolveConstraintDatabaseUrl(
    process.env.CONSTRAINT_TEST_DATABASE_URL,
    process.env.LESSONFORGE_CONSTRAINT_TEST,
  );
  const database = createDatabaseClient(url);
  db = database;
  await initializeConstraintDatabase(database, async () => {
    try {
      await exec(
        process.execPath,
        [
          fileURLToPath(
            new URL('../node_modules/prisma/build/index.js', import.meta.url),
          ),
          'migrate',
          'deploy',
          '--config',
          'prisma.constraints.config.ts',
        ],
        {
          cwd: fileURLToPath(new URL('../', import.meta.url)),
          env: { ...process.env, DATABASE_URL: undefined },
          timeout: 45_000,
        },
      );
    } catch {
      // execFile buffers CLI output; do not print possibly sensitive error output.
      throw new Error(
        'Migration deployment failed on the disposable database.',
      );
    }
    await database.user.createMany({
      data: [
        {
          id: ids.teacher,
          email: 'teacher@example.test',
          displayName: 'Teacher',
          passwordHash: 'test-only-hash',
          role: 'TEACHER',
        },
        {
          id: ids.admin,
          email: 'admin@example.test',
          displayName: 'Admin',
          passwordHash: 'test-only-hash',
          role: 'ADMIN',
        },
        {
          id: ids.otherTeacher,
          email: 'other@example.test',
          displayName: 'Other teacher',
          passwordHash: 'test-only-hash',
          role: 'TEACHER',
        },
      ],
    });
    await database.curriculumResource.createMany({
      data: [ids.resource, ids.otherResource].map((id) => ({
        id,
        title: 'Fraction demonstration',
        subject: 'Mathematics',
        grade: 'Grade 4',
        sourceReference:
          'Original demonstration material; no official curriculum alignment.',
        contentText: 'One half is one of two equal parts.',
      })),
    });
    await database.lesson.createMany({
      data: [ids.lesson, ids.otherLesson].map((id) => ({
        id,
        ownerId: ids.teacher,
        draftContent: {},
        draftGenerationOrigin: 'MANUAL' as const,
      })),
    });
    await database.lessonRevision.createMany({
      data: [
        {
          id: ids.revision,
          lessonId: ids.lesson,
          number: 1,
          content: {},
          generationOrigin: 'MANUAL',
        },
        {
          id: ids.otherRevision,
          lessonId: ids.otherLesson,
          number: 1,
          content: {},
          generationOrigin: 'AI_ASSISTED',
        },
      ],
    });
    await database.revisionSource.create({
      data: {
        revisionId: ids.revision,
        resourceId: ids.resource,
        resourceVersion: 1,
        snapshot: { title: 'Fraction demonstration' },
      },
    });
    await database.review.create({
      data: {
        id: ids.review,
        revisionId: ids.revision,
        reviewerId: ids.admin,
        decision: 'APPROVE',
      },
    });
    await database.lesson.update({
      where: { id: ids.lesson },
      data: {
        currentRevisionId: ids.revision,
        draftContent: Prisma.DbNull,
        draftGenerationOrigin: null,
        version: { increment: 1 },
      },
    });
  });
});

afterAll(async () => {
  if (db) await db.$disconnect();
});

it('applies the tracked migration and inserts valid relations through the generated client', async () => {
  const migrations = await client().$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
  `;
  expect(migrations[0].count).toBe(1n);
  const lesson = await client().lesson.findUniqueOrThrow({
    where: { id: ids.lesson },
    include: { currentRevision: { include: { sources: true, review: true } } },
  });
  expect(lesson.currentRevision?.lessonId).toBe(ids.lesson);
  expect(lesson.currentRevision?.sources).toHaveLength(1);
  expect(lesson.currentRevision?.review?.decision).toBe('APPROVE');
  expect(lesson.draftContent).toBeNull();
  expect(lesson.createdAt).toBeInstanceOf(Date);
  const copy = await client().lesson.create({
    data: {
      ownerId: ids.otherTeacher,
      copiedFromRevisionId: ids.revision,
      draftContent: {},
      draftGenerationOrigin: 'MANUAL',
    },
  });
  expect(copy.id).toMatch(/^[0-9a-f-]{36}$/);
  const changeRequest = await client().review.create({
    data: {
      revisionId: ids.otherRevision,
      reviewerId: ids.admin,
      decision: 'REQUEST_CHANGES',
      feedback: 'Explain the equal parts.',
    },
  });
  expect(changeRequest.feedback).toBe('Explain the equal parts.');
});

it.each(['other lesson', 'nonexistent revision'])(
  'rejects a current pointer to %s',
  async (kind) => {
    await rejectsSql(
      'UPDATE "Lesson" SET "currentRevisionId" = $1::uuid WHERE id = $2::uuid',
      [kind === 'other lesson' ? ids.otherRevision : randomUUID(), ids.lesson],
      '23503',
    );
  },
);

it('rejects duplicate revision numbers', async () => {
  await rejectsSql(
    'INSERT INTO "LessonRevision" (id, "lessonId", number, content, "generationOrigin") VALUES ($1::uuid, $2::uuid, 1, \'{}\'::jsonb, \'MANUAL\')',
    [randomUUID(), ids.lesson],
    '23505',
  );
});

it('rejects duplicate reviews and resource references', async () => {
  await rejectsSql(
    'INSERT INTO "Review" (id, "revisionId", "reviewerId", decision) VALUES ($1::uuid, $2::uuid, $3::uuid, \'APPROVE\')',
    [randomUUID(), ids.revision, ids.admin],
    '23505',
  );
  await rejectsSql(
    'INSERT INTO "RevisionSource" ("revisionId", "resourceId", "resourceVersion", snapshot) VALUES ($1::uuid, $2::uuid, 1, \'{}\'::jsonb)',
    [ids.revision, ids.resource],
    '23505',
  );
});

it('rejects duplicate canonical emails', async () => {
  await rejectsSql(
    'INSERT INTO "User" (id, email, "displayName", "passwordHash", role, "updatedAt") VALUES ($1::uuid, \'teacher@example.test\', \'Teacher\', \'fixture\', \'TEACHER\', now())',
    [randomUUID()],
    '23505',
  );
});

it.each([
  'Teacher@example.test',
  ' teacher@example.test',
  'teacher@example.test ',
  '\tteacher@example.test',
  '',
  '\n',
])('rejects noncanonical email %j', async (email) => {
  await rejectsSql(
    'INSERT INTO "User" (id, email, "displayName", "passwordHash", role, "updatedAt") VALUES ($1::uuid, $2, \'Teacher\', \'fixture\', \'TEACHER\', now())',
    [randomUUID(), email],
    '23514',
  );
});

it.each([0, -1])(
  'rejects nonpositive counters (%s) in all four tables',
  async (value) => {
    await rejectsSql(
      'UPDATE "Lesson" SET version = $1 WHERE id = $2::uuid',
      [value, ids.lesson],
      '23514',
    );
    await rejectsSql(
      'UPDATE "CurriculumResource" SET version = $1 WHERE id = $2::uuid',
      [value, ids.resource],
      '23514',
    );
    await rejectsSql(
      'INSERT INTO "LessonRevision" (id, "lessonId", number, content, "generationOrigin") VALUES ($1::uuid, $2::uuid, $3, \'{}\'::jsonb, \'MANUAL\')',
      [randomUUID(), ids.lesson, value],
      '23514',
    );
    await rejectsSql(
      'INSERT INTO "RevisionSource" ("revisionId", "resourceId", "resourceVersion", snapshot) VALUES ($1::uuid, $2::uuid, $3, \'{}\'::jsonb)',
      [ids.revision, ids.otherResource, value],
      '23514',
    );
  },
);

it.each(['[]', 'null', '"text"', '1'])(
  'rejects nonobject JSON %s in draft, revision, and snapshot',
  async (value) => {
    await rejectsSql(
      'UPDATE "Lesson" SET "draftContent" = $1::jsonb WHERE id = $2::uuid',
      [value, ids.otherLesson],
      '23514',
    );
    await rejectsSql(
      'INSERT INTO "LessonRevision" (id, "lessonId", number, content, "generationOrigin") VALUES ($1::uuid, $2::uuid, 2, $3::jsonb, \'MANUAL\')',
      [randomUUID(), ids.lesson, value],
      '23514',
    );
    await rejectsSql(
      'INSERT INTO "RevisionSource" ("revisionId", "resourceId", "resourceVersion", snapshot) VALUES ($1::uuid, $2::uuid, 1, $3::jsonb)',
      [ids.revision, ids.otherResource, value],
      '23514',
    );
  },
);

it('rejects mismatched SQL-null draft/origin pairs', async () => {
  await rejectsSql(
    'UPDATE "Lesson" SET "draftContent" = NULL WHERE id = $1::uuid',
    [ids.otherLesson],
    '23514',
  );
  await rejectsSql(
    'UPDATE "Lesson" SET "draftGenerationOrigin" = NULL WHERE id = $1::uuid',
    [ids.otherLesson],
    '23514',
  );
});

it.each([null, '', ' ', '\t\n'])(
  'rejects blank change-request feedback %j',
  async (feedback) => {
    await rejectsSql(
      'INSERT INTO "Review" (id, "revisionId", "reviewerId", decision, feedback) VALUES ($1::uuid, $2::uuid, $3::uuid, \'REQUEST_CHANGES\', $4)',
      [randomUUID(), ids.otherRevision, ids.admin, feedback],
      '23514',
    );
  },
);

it('rejects missing required values and orphan foreign keys', async () => {
  await rejectsSql(
    'INSERT INTO "LessonRevision" (id, "lessonId", number, "generationOrigin") VALUES ($1::uuid, $2::uuid, 2, \'MANUAL\')',
    [randomUUID(), ids.lesson],
    '23502',
  );
  await rejectsSql(
    'INSERT INTO "Lesson" (id, "ownerId", "updatedAt") VALUES ($1::uuid, $2::uuid, now())',
    [randomUUID(), randomUUID()],
    '23503',
  );
  await rejectsSql(
    'INSERT INTO "Review" (id, "revisionId", "reviewerId", decision) VALUES ($1::uuid, $2::uuid, $3::uuid, \'APPROVE\')',
    [randomUUID(), randomUUID(), ids.admin],
    '23503',
  );
  await rejectsSql(
    'INSERT INTO "Lesson" (id, "ownerId", "copiedFromRevisionId", "updatedAt") VALUES ($1::uuid, $2::uuid, $3::uuid, now())',
    [randomUUID(), ids.teacher, randomUUID()],
    '23503',
  );
  await rejectsSql(
    'INSERT INTO "LessonRevision" (id, "lessonId", number, content, "generationOrigin") VALUES ($1::uuid, $2::uuid, 1, \'{}\'::jsonb, \'MANUAL\')',
    [randomUUID(), randomUUID()],
    '23503',
  );
  await rejectsSql(
    'INSERT INTO "RevisionSource" ("revisionId", "resourceId", "resourceVersion", snapshot) VALUES ($1::uuid, $2::uuid, 1, \'{}\'::jsonb)',
    [ids.revision, randomUUID()],
    '23503',
  );
  await rejectsSql(
    'INSERT INTO "RevisionSource" ("revisionId", "resourceId", "resourceVersion", snapshot) VALUES ($1::uuid, $2::uuid, 1, \'{}\'::jsonb)',
    [randomUUID(), ids.resource],
    '23503',
  );
});

it.each([
  ['User', ids.teacher],
  ['User', ids.admin],
  ['CurriculumResource', ids.resource],
  ['Lesson', ids.lesson],
])('restricts deletion of referenced %s', async (table, id) => {
  // Table identifiers come only from the fixed test cases, never external input.
  await rejectsSql(`DELETE FROM "${table}" WHERE id = $1::uuid`, [id], '23503');
});

it.each([
  ['User', ids.teacher, 'Lesson_ownerId_fkey'],
  ['CurriculumResource', ids.resource, 'RevisionSource_resourceId_fkey'],
  ['Lesson', ids.otherLesson, 'LessonRevision_lessonId_fkey'],
])('restricts referenced %s key updates', async (table, id, fk) => {
  // The other lesson has no current pointer: its outgoing composite FK cannot
  // mask the incoming LessonRevision FK. Owner/copy fields stay unchanged, so
  // the lesson identity trigger cannot supply a false positive either.
  expect(
    (
      await client().lesson.findUniqueOrThrow({
        where: { id: ids.otherLesson },
      })
    ).currentRevisionId,
  ).toBeNull();
  const before = await databaseSnapshot();
  const replacement = randomUUID();
  await rejectsSql(
    `UPDATE "${table}" SET id = $1::uuid WHERE id = $2::uuid`,
    [replacement, id],
    '23503',
    fk,
  );
  expect(await databaseSnapshot()).toEqual(before);
  const keys = await client().$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "${table}" WHERE id IN ($1::uuid, $2::uuid)`,
    id,
    replacement,
  );
  expect(keys).toEqual([{ id }]);
});

it.each(['LessonRevision', 'RevisionSource', 'Review'])(
  'rejects updates and deletes of %s history',
  async (table) => {
    const column = table === 'RevisionSource' ? 'revisionId' : 'id';
    const id = table === 'Review' ? ids.review : ids.revision;
    await rejectsSql(
      `UPDATE "${table}" SET "${column}" = "${column}" WHERE "${column}" = $1::uuid`,
      [id],
      '23514',
    );
    await rejectsSql(
      `DELETE FROM "${table}" WHERE "${column}" = $1::uuid`,
      [id],
      '23514',
    );
  },
);

it('keeps ownership and copy provenance write-once, including null changes', async () => {
  await rejectsSql(
    'UPDATE "Lesson" SET "ownerId" = $1::uuid WHERE id = $2::uuid',
    [ids.otherTeacher, ids.lesson],
    '23514',
  );
  await rejectsSql(
    'UPDATE "Lesson" SET "copiedFromRevisionId" = $1::uuid WHERE id = $2::uuid',
    [ids.revision, ids.lesson],
    '23514',
  );
  const copy = await client().lesson.create({
    data: { ownerId: ids.teacher, copiedFromRevisionId: ids.revision },
  });
  await rejectsSql(
    'UPDATE "Lesson" SET "copiedFromRevisionId" = NULL WHERE id = $1::uuid',
    [copy.id],
    '23514',
  );
  await rejectsSql(
    'UPDATE "Lesson" SET "copiedFromRevisionId" = $1::uuid WHERE id = $2::uuid',
    [ids.otherRevision, copy.id],
    '23514',
  );
  await client().lesson.update({
    where: { id: copy.id },
    data: { version: { increment: 1 } },
  });
});

it('preserves submitted snapshots through resource update and retirement', async () => {
  const before = await client().revisionSource.findUniqueOrThrow({
    where: {
      revisionId_resourceId: {
        revisionId: ids.revision,
        resourceId: ids.resource,
      },
    },
  });
  await client().curriculumResource.update({
    where: { id: ids.resource },
    data: {
      contentText: 'Changed demonstration',
      retiredAt: new Date(),
      version: { increment: 1 },
    },
  });
  const after = await client().revisionSource.findUniqueOrThrow({
    where: {
      revisionId_resourceId: {
        revisionId: ids.revision,
        resourceId: ids.resource,
      },
    },
  });
  expect(after).toEqual(before);
});

it('demonstrates the source-insertion limitation rather than claiming full source-set immutability', async () => {
  await client().revisionSource.create({
    data: {
      revisionId: ids.revision,
      resourceId: ids.otherResource,
      resourceVersion: 1,
      snapshot: {},
    },
  });
  // Database allows this later insert. Future NestJS submission paths must forbid it.
  expect(
    await client().revisionSource.count({
      where: { revisionId: ids.revision },
    }),
  ).toBe(2);
});

// Compare every migrated row and public object, including migration bookkeeping.
// Fixed identifiers only; no connection strings or driver errors enter snapshots.
async function databaseSnapshot() {
  const rows: Record<string, unknown> = {};
  for (const table of [
    'User',
    'CurriculumResource',
    'Lesson',
    'LessonRevision',
    'Review',
    'RevisionSource',
    '_prisma_migrations',
  ]) {
    rows[table] = await client().$queryRawUnsafe(
      `SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
    );
  }
  const objects = await client().$queryRaw`
    SELECT 'class' AS kind, relname AS name FROM pg_class WHERE relnamespace = 'public'::regnamespace
    UNION ALL SELECT 'type', typname FROM pg_type WHERE typnamespace = 'public'::regnamespace
    UNION ALL SELECT 'function', proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace
    ORDER BY kind, name
  `;
  return { rows, objects };
}

it('refuses a populated disposable database without changing its contents', async () => {
  const before = await databaseSnapshot();
  let initialized = false;
  await expect(
    initializeConstraintDatabase(client(), async () => {
      initialized = true;
    }),
  ).rejects.toThrow('Disposable database public schema must be empty.');
  expect(initialized).toBe(false);
  expect(await databaseSnapshot()).toEqual(before);
});

it('refuses mismatched live identity before migrations or fixtures', async () => {
  const before = await databaseSnapshot();
  let initialized = false;
  // The documented disposable image creates a superuser. Use a built-in
  // read-only role on this transaction only; create no role or alternate target.
  await client().$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL ROLE pg_read_all_data`;
    const identity = await tx.$queryRaw<
      { role: string }[]
    >`SELECT current_user AS role`;
    expect(identity[0].role).toBe('pg_read_all_data');
    await expect(
      initializeConstraintDatabase(tx, async () => {
        initialized = true;
      }),
    ).rejects.toThrow('Disposable database identity does not match.');
  });
  expect(initialized).toBe(false);
  const identity = await client().$queryRaw<
    { role: string }[]
  >`SELECT current_user AS role`;
  expect(identity[0].role).toBe('lessonforge_constraints');
  expect(await databaseSnapshot()).toEqual(before);
});
