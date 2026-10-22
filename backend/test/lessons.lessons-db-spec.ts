import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { createDatabaseClient } from '../src/prisma/prisma.service.js';
import { LessonsService } from '../src/lessons/lessons.service.js';
import { ResourcesService } from '../src/resources/resources.service.js';
import { resourceInput } from '../src/resources/resources.input.js';
import { resolveConstraintDatabaseUrl } from './support/constraint-database.js';
import { initializeConstraintDatabase } from './support/constraint-preflight.js';

let db: PrismaClient, other: PrismaClient;
let lessons: LessonsService,
  competitor: LessonsService,
  resources: ResourcesService;
let teacher: { id: string; role: 'TEACHER' }, foreign: typeof teacher;
let admin: { id: string; role: 'ADMIN' };
const content = resourceInput({
  title: 'Equal parts',
  subject: 'Mathematics',
  grade: 'Grade 4',
  sourceReference: 'Original demonstration; no official alignment',
  contentText: 'One half is one of two equal parts.',
});
beforeAll(async () => {
  // No real environment loader/fallback: guards run before migrations or fixtures.
  const url = resolveConstraintDatabaseUrl(
    process.env.CONSTRAINT_TEST_DATABASE_URL,
    process.env.LESSONFORGE_CONSTRAINT_TEST,
  );
  db = createDatabaseClient(url);
  await initializeConstraintDatabase(db, async () => {
    try {
      await promisify(execFile)(
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
          timeout: 45000,
        },
      );
    } catch {
      throw new Error('Disposable lesson migration deployment failed.');
    }
  });
  other = createDatabaseClient(url);
  lessons = new LessonsService(db);
  competitor = new LessonsService(other);
  resources = new ResourcesService(other);
  async function user(name: string, role: 'TEACHER' | 'ADMIN') {
    return db.user.create({
      data: {
        email: `${name}@example.test`,
        displayName: name,
        passwordHash: 'fixture-no-login',
        role,
      },
    });
  }
  teacher = { id: (await user('owner', 'TEACHER')).id, role: 'TEACHER' };
  foreign = { id: (await user('other', 'TEACHER')).id, role: 'TEACHER' };
  admin = { id: (await user('admin', 'ADMIN')).id, role: 'ADMIN' };
});
afterAll(async () => {
  await Promise.all([db?.$disconnect(), other?.$disconnect()]);
});
const draft = () =>
  lessons.create(teacher, {
    title: 'Incomplete fractions',
    materials: [],
    activities: [{}],
    durationMinutes: 0,
  });
const resource = () => resources.create('ADMIN', content);

it('persists incomplete manual drafts with server ownership and no submitted revisions across clients', async () => {
  const created = await draft();
  expect(await competitor.detail(teacher, created.id)).toEqual(created);
  expect(
    (await db.lesson.findUniqueOrThrow({ where: { id: created.id } })).ownerId,
  ).toBe(teacher.id);
  const saved = await lessons.mutate(teacher, created.id, 1, { content: {} });
  expect(saved.version).toBe(2);
  expect(saved.content).toEqual({});
  expect(await db.lessonRevision.count()).toBe(0);
  expect(await competitor.detail(teacher, created.id)).toEqual(saved);
});
it('rejects other teachers/admins without leaking current content and filters list ownership', async () => {
  const created = await draft();
  const source = await resource();
  for (const actor of [foreign, admin]) {
    const status = actor.role === 'ADMIN' ? 403 : 404;
    await expect(lessons.detail(actor, created.id)).rejects.toMatchObject({
      status,
    });
    for (const change of [
      { content: {} },
      ...(['select', 'remove', 'refresh'] as const).map((action) => ({
        action,
        resourceId: source.id,
      })),
    ])
      await expect(
        lessons.mutate(actor, created.id, 999, change),
      ).rejects.toMatchObject({ status });
  }
  expect((await lessons.list(foreign, 50)).items).toEqual([]);
  const first = await lessons.list(teacher, 1);
  const next = await lessons.list(teacher, 50, first.nextAfter!);
  expect(next.items.every((v) => v.id > first.items[0]!.id)).toBe(true);
  await expect(lessons.create(admin, {})).rejects.toMatchObject({
    status: 403,
  });
});
it('allows exactly one of two competing saves and preserves the winner', async () => {
  const created = await draft();
  const results = await Promise.allSettled([
    lessons.mutate(teacher, created.id, 1, { content: { title: 'First' } }),
    competitor.mutate(teacher, created.id, 1, { content: { title: 'Second' } }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((r) => r.status === 'rejected')!.reason).toMatchObject({
    status: 409,
  });
  expect(await lessons.detail(teacher, created.id)).toEqual(
    results.find((r) => r.status === 'fulfilled')!.value,
  );
});
it('serializes competing content/source mutations under the same lesson version', async () => {
  for (const action of ['select', 'remove', 'refresh'] as const) {
    let created = await draft();
    const source = await resource();
    if (action !== 'select')
      created = await lessons.mutate(teacher, created.id, 1, {
        action: 'select',
        resourceId: source.id,
      });
    const results = await Promise.allSettled([
      lessons.mutate(teacher, created.id, created.version, {
        content: { title: 'Save contender' },
      }),
      competitor.mutate(teacher, created.id, created.version, {
        action,
        resourceId: source.id,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')!.reason).toMatchObject({
      status: 409,
    });
    expect((await lessons.detail(teacher, created.id)).version).toBe(
      created.version + 1,
    );
  }
});
it('preserves old snapshots on saves after edits/retirement; rejects refresh but allows removal', async () => {
  const created = await draft(),
    source = await resource();
  const selected = await lessons.mutate(teacher, created.id, 1, {
    action: 'select',
    resourceId: source.id,
  });
  await resources.mutate('ADMIN', source.id, 1, {
    ...content,
    contentText: 'Updated resource',
  });
  const saved = await lessons.mutate(teacher, created.id, 2, {
    content: { title: 'Entered lesson' },
  });
  expect(saved.sources).toEqual(selected.sources);
  const refreshed = await lessons.mutate(teacher, created.id, 3, {
    action: 'refresh',
    resourceId: source.id,
  });
  expect(refreshed.sources[0]!.resourceVersion).toBe(2);
  await resources.mutate('ADMIN', source.id, 2);
  const retained = await lessons.mutate(teacher, created.id, 4, {
    content: {},
  });
  expect(retained.sources).toEqual(refreshed.sources);
  await expect(
    lessons.mutate(teacher, created.id, 5, {
      action: 'refresh',
      resourceId: source.id,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await lessons.detail(teacher, created.id)).toEqual(retained);
  expect(
    (
      await lessons.mutate(teacher, created.id, 5, {
        action: 'remove',
        resourceId: source.id,
      })
    ).sources,
  ).toEqual([]);
  await expect(
    lessons.mutate(teacher, created.id, 6, {
      action: 'select',
      resourceId: source.id,
    }),
  ).rejects.toMatchObject({ status: 409 });
});
it('captures coherent resource versions when source selection/refresh races an edit/retirement', async () => {
  for (const action of ['select', 'refresh'] as const)
    for (const retire of [false, true]) {
      let created = await draft();
      const source = await resource();
      if (action === 'refresh')
        created = await lessons.mutate(teacher, created.id, 1, {
          action: 'select',
          resourceId: source.id,
        });
      const results = await Promise.allSettled([
        lessons.mutate(teacher, created.id, created.version, {
          action,
          resourceId: source.id,
        }),
        resources.mutate(
          'ADMIN',
          source.id,
          1,
          retire
            ? undefined
            : { ...content, title: 'New resource', contentText: 'New content' },
        ),
      ]);
      expect(results[1].status).toBe('fulfilled');
      const saved = await lessons.detail(teacher, created.id);
      if (results[0].status === 'fulfilled') {
        const selected = saved.sources[0]!;
        expect(selected.snapshot).toEqual(
          selected.resourceVersion === 1
            ? content
            : { ...content, title: 'New resource', contentText: 'New content' },
        );
        if (retire) expect(selected.resourceVersion).toBe(1);
      } else {
        expect(retire).toBe(true);
        expect(results[0].reason).toMatchObject({ status: 409 });
        expect(saved).toEqual(created);
      }
    }
});
it('waits behind a held resource lock and then rejects retirement without changing the draft', async () => {
  const created = await draft(),
    source = await resource();
  let release!: () => void, locked!: () => void;
  const ready = new Promise<void>((r) => {
    locked = r;
  });
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const holding = other.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CurriculumResource" WHERE id = ${source.id}::uuid FOR UPDATE`;
    locked();
    await gate;
    await tx.curriculumResource.update({
      where: { id: source.id },
      data: { retiredAt: new Date(), version: { increment: 1 } },
    });
  });
  await ready;
  const pending = lessons.mutate(teacher, created.id, 1, {
    action: 'select',
    resourceId: source.id,
  });
  try {
    const deadline = Date.now() + 3000;
    let waiting = false;
    while (Date.now() < deadline) {
      const rows = await other.$queryRaw<
        { waiting: boolean }[]
      >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%CurriculumResource%FOR SHARE%') AS waiting`;
      if (rows[0]?.waiting) {
        waiting = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(waiting).toBe(true);
  } finally {
    release();
    await holding;
  }
  await expect(pending).rejects.toMatchObject({ status: 409 });
  expect(await lessons.detail(teacher, created.id)).toEqual(created);
});
it.each(['save', 'select', 'remove', 'refresh'] as const)(
  'checks lifecycle after an observed lesson-lock wait for %s without changing committed draft/source state',
  async (action) => {
    const created = await draft();
    const source = await resource();
    const selected = await lessons.mutate(teacher, created.id, 1, {
      action: 'select',
      resourceId: source.id,
    });
    const newSource = action === 'select' ? await resource() : source;
    const revision = await db.lessonRevision.create({
      data: {
        lessonId: created.id,
        number: 1,
        generationOrigin: 'MANUAL',
        content: selected.content,
      },
    });
    const snapshot = await db.revisionSource.create({
      data: {
        revisionId: revision.id,
        resourceId: source.id,
        resourceVersion: selected.sources[0]!.resourceVersion,
        snapshot: selected.sources[0]!.snapshot,
      },
    });
    let release!: () => void, locked!: (pid: number) => void;
    const ready = new Promise<number>((r) => {
      locked = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const holding = other.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Lesson" WHERE id = ${created.id}::uuid FOR UPDATE`;
      const [{ pid }] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      locked(pid!);
      await gate;
      // This fixture transition intentionally clears the draft; the waiting mutation
      // must preserve exactly this committed state and its submitted source snapshot.
      return tx.lesson.update({
        where: { id: created.id },
        data: {
          currentRevisionId: revision.id,
          draftContent: Prisma.DbNull,
          draftGenerationOrigin: null,
          version: { increment: 1 },
        },
      });
    });
    const holderPid = await ready;
    let settled = false;
    const pending = Promise.allSettled([
      lessons.mutate(
        teacher,
        created.id,
        selected.version,
        action === 'save'
          ? { content: { title: 'Must not overwrite' } }
          : { action, resourceId: newSource.id },
      ),
    ]).finally(() => {
      settled = true;
    });
    try {
      const deadline = Date.now() + 3000;
      let waiting = false;
      while (Date.now() < deadline) {
        const rows = await other.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND ${holderPid} = ANY(pg_blocking_pids(pid))
              AND query LIKE '%FROM "Lesson"%FOR UPDATE%'
          ) AS waiting
        `;
        if (rows[0]?.waiting) {
          waiting = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(waiting).toBe(true);
      expect(settled).toBe(false);
    } finally {
      release();
      // Drain both promises even if the observed-wait assertion fails.
      await Promise.allSettled([holding, pending]);
    }
    const committed = await holding;
    const [result] = await pending;
    expect(result!.status).toBe('rejected');
    if (result!.status !== 'rejected')
      throw new Error('Waiting mutation unexpectedly succeeded.');
    expect(result!.reason).toMatchObject({
      status: 409,
      message: 'Lesson state conflict.',
    });
    expect(
      await db.lesson.findUniqueOrThrow({ where: { id: created.id } }),
    ).toEqual(committed);
    expect(committed.draftContent).toBeNull();
    expect(committed.draftGenerationOrigin).toBeNull();
    expect(committed.version).toBe(selected.version + 1);
    expect(
      await db.lessonRevision.findUniqueOrThrow({ where: { id: revision.id } }),
    ).toEqual(revision);
    expect(
      await db.revisionSource.findUniqueOrThrow({
        where: {
          revisionId_resourceId: {
            revisionId: revision.id,
            resourceId: source.id,
          },
        },
      }),
    ).toEqual(snapshot);
    await db.review.create({
      data: {
        revisionId: revision.id,
        reviewerId: admin.id,
        decision: 'APPROVE',
      },
    });
    await expect(
      lessons.mutate(teacher, created.id, committed.version, { content: {} }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await lessons.list(teacher, 50)).items.some((v) => v.id === created.id),
    ).toBe(false);
  },
);
it('saves changes-requested fixtures without modifying the submitted revision, review, or snapshot', async () => {
  const created = await draft(),
    source = await resource();
  const selected = await lessons.mutate(teacher, created.id, 1, {
    action: 'select',
    resourceId: source.id,
  });
  const revision = await db.lessonRevision.create({
    data: {
      lessonId: created.id,
      number: 1,
      content: { title: 'Historical fixture' },
      generationOrigin: 'MANUAL',
    },
  });
  const snapshot = await db.revisionSource.create({
    data: {
      revisionId: revision.id,
      resourceId: source.id,
      resourceVersion: 1,
      snapshot: content,
    },
  });
  const review = await db.review.create({
    data: {
      revisionId: revision.id,
      reviewerId: admin.id,
      decision: 'REQUEST_CHANGES',
      feedback: 'Fixture feedback',
    },
  });
  await db.lesson.update({
    where: { id: created.id },
    data: { currentRevisionId: revision.id, version: { increment: 1 } },
  });
  const saved = await lessons.mutate(teacher, created.id, 3, {
    content: { title: 'New incomplete work' },
  });
  expect(saved.state).toBe('CHANGES_REQUESTED');
  expect(saved.sources).toEqual(selected.sources);
  expect(
    await db.lessonRevision.findUniqueOrThrow({ where: { id: revision.id } }),
  ).toEqual(revision);
  expect(
    await db.revisionSource.findUniqueOrThrow({
      where: {
        revisionId_resourceId: {
          revisionId: revision.id,
          resourceId: source.id,
        },
      },
    }),
  ).toEqual(snapshot);
  expect(
    await db.review.findUniqueOrThrow({ where: { id: review.id } }),
  ).toEqual(review);
});
it('rolls back actual content/source writes, version and timestamps on a post-write transaction failure', async () => {
  const created = await draft(),
    source = await resource();
  const failing = new LessonsService({
    $transaction: (
      run: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: object,
    ) =>
      db.$transaction(async (tx) => {
        await run(tx);
        throw new Error('Injected rollback');
      }, options),
  } as unknown as PrismaClient);
  for (const change of [
    { content: { title: 'Discarded' } },
    { action: 'select' as const, resourceId: source.id },
  ]) {
    await expect(
      failing.mutate(teacher, created.id, 1, change),
    ).rejects.toThrow('Injected rollback');
    expect(await competitor.detail(teacher, created.id)).toEqual(created);
  }
});
