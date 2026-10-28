import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { createDatabaseClient } from '../src/prisma/prisma.service.js';
import { LessonsService } from '../src/lessons/lessons.service.js';
import { LessonWorkflowService } from '../src/lessons/lesson-workflow.service.js';
import { completeContent } from './support/submission-content.js';
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

// These tests use real lifecycle services, not fixture lifecycle transitions.
const workflow = () => new LessonWorkflowService(db);
const competingWorkflow = () => new LessonWorkflowService(other);
async function prepared() {
  let created = await lessons.create(teacher, structuredClone(completeContent));
  for (let i = 0; i < 2; i++) {
    const source = await resource();
    created = await lessons.mutate(teacher, created.id, created.version, {
      action: 'select',
      resourceId: source.id,
    });
  }
  return created;
}
function allRows(id: string) {
  return db.lesson.findUniqueOrThrow({
    where: { id },
    include: {
      revisions: {
        orderBy: { number: 'asc' },
        include: { sources: { orderBy: { resourceId: 'asc' } }, review: true },
      },
    },
  });
}
function gateClient() {
  let release!: () => void;
  let ready!: (pid: number) => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const locked = new Promise<number>((resolve) => {
    ready = resolve;
  });
  const client = {
    $transaction: (
      run: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: object,
    ) =>
      db.$transaction(async (tx) => {
        const wrapped = new Proxy(tx, {
          get(target, key) {
            if (key !== '$queryRaw') return Reflect.get(target, key);
            return async (...args: unknown[]) => {
              const value = await Reflect.apply(target.$queryRaw, target, args);
              const sql = args[0] as TemplateStringsArray;
              if (Array.isArray(sql) && sql.join('').includes('FOR UPDATE')) {
                const [{ pid }] = await tx.$queryRaw<
                  { pid: number }[]
                >`SELECT pg_backend_pid() AS pid`;
                ready(pid!);
                await gate;
              }
              return value;
            };
          },
        });
        return run(wrapped);
      }, options),
  } as unknown as PrismaClient;
  return { client, locked, release };
}
async function observedRace(
  holder: (client: PrismaClient) => Promise<unknown>,
  waiter: () => Promise<unknown>,
) {
  const gate = gateClient();
  const holding = holder(gate.client);
  let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
  try {
    const pid = await Promise.race([
      gate.locked,
      holding.then(() => {
        throw new Error('Holder did not reach the lock gate.');
      }),
    ]);
    let settled = false;
    pending = Promise.allSettled([waiter()]).finally(() => {
      settled = true;
    });
    const deadline = Date.now() + 3000;
    let waiting = false;
    while (Date.now() < deadline) {
      const rows = await other.$queryRaw<{ waiting: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND ${pid} = ANY(pg_blocking_pids(pid))
            AND query LIKE '%FROM "Lesson"%FOR UPDATE%'
        ) AS waiting
      `;
      if (rows[0]?.waiting) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(waiting).toBe(true);
    expect(settled).toBe(false);
  } finally {
    gate.release();
    await Promise.allSettled([holding, ...(pending ? [pending] : [])]);
  }
  const winner = await holding;
  const [loser] = await pending!;
  expect(loser!.status).toBe('rejected');
  if (loser!.status !== 'rejected')
    throw new Error('Waiting mutation won unexpectedly.');
  expect(loser!.reason).toMatchObject({ status: 409 });
  return winner;
}

it('validates persisted completeness and sources without changing any draft/history row', async () => {
  const incomplete = await draft();
  const completeWithoutSources = await lessons.create(teacher, completeContent);
  for (const saved of [incomplete, completeWithoutSources]) {
    const before = await allRows(saved.id);
    await expect(
      workflow().submit(teacher, saved.id, saved.version),
    ).rejects.toMatchObject({ status: 400 });
    expect(await allRows(saved.id)).toEqual(before);
  }
});

it('authorizes before conflict disclosure and restricts submitted history and pending queries', async () => {
  const saved = await prepared();
  for (const version of [saved.version, 999]) {
    await expect(
      workflow().submit(foreign, saved.id, version),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      workflow().submit(admin, saved.id, version),
    ).rejects.toMatchObject({ status: 403 });
  }
  await expect(workflow().history(admin, saved.id, 20)).rejects.toMatchObject({
    status: 404,
  });
  await expect(workflow().history(foreign, saved.id, 20)).rejects.toMatchObject(
    { status: 404 },
  );
  await expect(workflow().pending(teacher, 20)).rejects.toMatchObject({
    status: 403,
  });
  expect((await workflow().history(teacher, saved.id, 20)).items).toEqual([]);
  const submitted = await workflow().submit(teacher, saved.id, saved.version);
  await expect(
    workflow().review(teacher, saved.id, submitted.revision.id, {
      expectedVersion: 999,
      decision: 'APPROVE',
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    workflow().detail(foreign, saved.id, submitted.revision.id),
  ).rejects.toMatchObject({ status: 404 });
  const detail = await workflow().detail(
    admin,
    saved.id,
    submitted.revision.id,
  );
  expect(Object.keys(detail).sort()).toEqual(['revision', 'workflow']);
  expect(Object.keys(detail.workflow).sort()).toEqual([
    'currentRevisionId',
    'lessonId',
    'state',
    'version',
  ]);
  expect(Object.keys(detail.revision).sort()).toEqual([
    'content',
    'generationOrigin',
    'id',
    'number',
    'review',
    'sources',
    'submittedAt',
  ]);
  expect(detail.revision.content).toEqual(saved.content);
});

it('observes a submission waiting behind a real save and preserves the save winner', async () => {
  const saved = await prepared();
  await observedRace(
    (client) =>
      new LessonsService(client).mutate(teacher, saved.id, saved.version, {
        content: { ...completeContent, title: 'Save winner' },
      }),
    () => competingWorkflow().submit(teacher, saved.id, saved.version),
  );
  const rows = await allRows(saved.id);
  expect(rows.revisions).toEqual([]);
  expect(rows.version).toBe(saved.version + 1);
  expect((rows.draftContent as { title: string }).title).toBe('Save winner');
});

it.each(['save', 'select', 'remove', 'refresh', 'submit'] as const)(
  'observes %s waiting behind actual submission and preserves the complete committed result',
  async (action) => {
    const saved = await prepared();
    const extra = await resource();
    const winner = (await observedRace(
      (client) =>
        new LessonWorkflowService(client).submit(
          teacher,
          saved.id,
          saved.version,
        ),
      () =>
        action === 'submit'
          ? competingWorkflow().submit(teacher, saved.id, saved.version)
          : competitor.mutate(
              teacher,
              saved.id,
              saved.version,
              action === 'save'
                ? { content: { title: 'Discard' } }
                : {
                    action,
                    resourceId:
                      action === 'select'
                        ? extra.id
                        : saved.sources[0]!.resourceId,
                  },
            ),
    )) as Awaited<ReturnType<LessonWorkflowService['submit']>>;
    const rows = await allRows(saved.id);
    expect(rows.version).toBe(saved.version + 1);
    expect(rows.draftContent).toBeNull();
    expect(rows.draftGenerationOrigin).toBeNull();
    expect(rows.currentRevisionId).toBe(winner.revision.id);
    expect(rows.revisions).toHaveLength(1);
    expect(rows.revisions[0]!.content).toEqual(saved.content);
    expect(winner.revision.sources).toEqual(
      [...saved.sources].sort((a, b) =>
        a.resourceId.localeCompare(b.resourceId),
      ),
    );
    expect(
      await competingWorkflow().detail(teacher, saved.id, winner.revision.id),
    ).toEqual(winner);
    for (const version of [saved.version, winner.workflow.version])
      await expect(
        workflow().submit(teacher, saved.id, version),
      ).rejects.toMatchObject({ status: 409 });
    expect(await allRows(saved.id)).toEqual(rows);
  },
);

it.each([
  ['APPROVE', 'REQUEST_CHANGES'],
  ['REQUEST_CHANGES', 'APPROVE'],
  ['APPROVE', 'APPROVE'],
  ['REQUEST_CHANGES', 'REQUEST_CHANGES'],
] as const)(
  'observes competing %s / %s decisions and commits one immutable winner',
  async (first, second) => {
    const saved = await prepared();
    const submitted = await workflow().submit(teacher, saved.id, saved.version);
    const originalRevision = (await allRows(saved.id)).revisions[0]!;
    const secondAdmin = {
      id: (
        await db.user.create({
          data: {
            email: `reviewer-${saved.id}@example.test`,
            displayName: 'Other reviewer',
            passwordHash: 'fixture',
            role: 'ADMIN',
          },
        })
      ).id,
      role: 'ADMIN' as const,
    };
    await observedRace(
      (client) =>
        new LessonWorkflowService(client).review(
          admin,
          saved.id,
          submitted.revision.id,
          {
            expectedVersion: submitted.workflow.version,
            decision: first,
            feedback: 'Winner feedback',
          },
        ),
      () =>
        competingWorkflow().review(
          secondAdmin,
          saved.id,
          submitted.revision.id,
          {
            expectedVersion: submitted.workflow.version,
            decision: second,
            feedback: 'Loser feedback',
          },
        ),
    );
    const rows = await allRows(saved.id);
    expect(rows.revisions).toHaveLength(1);
    expect(rows.revisions[0]!.review).toMatchObject({
      reviewerId: admin.id,
      decision: first,
      feedback: 'Winner feedback',
    });
    expect(rows.version).toBe(submitted.workflow.version + 1);
    expect(rows.currentRevisionId).toBe(submitted.revision.id);
    expect({ ...rows.revisions[0], review: null }).toEqual(originalRevision);
    if (first === 'APPROVE') {
      expect(rows.draftContent).toBeNull();
      await expect(
        lessons.mutate(teacher, saved.id, rows.version, { content: {} }),
      ).rejects.toMatchObject({ status: 409 });
    } else {
      const restored = await lessons.detail(teacher, saved.id);
      expect(restored.content).toEqual(saved.content);
      expect(restored.generationOrigin).toBe(saved.generationOrigin);
      expect(restored.sources).toEqual(submitted.revision.sources);
    }
    for (const version of [submitted.workflow.version, rows.version])
      await expect(
        workflow().review(admin, saved.id, submitted.revision.id, {
          expectedVersion: version,
          decision: first,
          feedback: 'Repeat',
        }),
      ).rejects.toMatchObject({ status: 409 });
    expect(await allRows(saved.id)).toEqual(rows);
  },
);

type FailureStage =
  'revision' | 'partialSources' | 'sources' | 'review' | 'lesson';
function failAfterWrite(stage: FailureStage) {
  let wrote = false;
  const stages = {
    revision: ['lessonRevision', 'create'],
    partialSources: ['revisionSource', 'createMany'],
    sources: ['revisionSource', 'createMany'],
    review: ['review', 'create'],
    lesson: ['lesson', 'updateMany'],
  };
  const [modelName, methodName] = stages[stage]!;
  const client = {
    $transaction: (
      run: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: object,
    ) =>
      db.$transaction(async (tx) => {
        const wrapped = new Proxy(tx, {
          get(target, key) {
            const model = Reflect.get(target, key);
            if (key !== modelName) return model;
            return new Proxy(model as object, {
              get(delegate, method) {
                const original = Reflect.get(delegate, method);
                if (method !== methodName) return original;
                return async (...args: unknown[]) => {
                  if (stage === 'partialSources') {
                    const input = args[0] as { data: object[] };
                    args[0] = { ...input, data: input.data.slice(0, 1) };
                  }
                  await Reflect.apply(
                    original as (...input: unknown[]) => unknown,
                    delegate,
                    args,
                  );
                  wrote = true;
                  throw new Error('Injected after actual write');
                };
              },
            });
          },
        });
        return run(wrapped);
      }, options),
  } as unknown as PrismaClient;
  return { service: new LessonWorkflowService(client), wrote: () => wrote };
}

it.each(['revision', 'partialSources', 'sources', 'lesson'] as const)(
  'rolls back submission after actual %s writes, including timestamps and all sources',
  async (stage) => {
    const saved = await prepared();
    const before = await allRows(saved.id);
    const failing = failAfterWrite(stage);
    await expect(
      failing.service.submit(teacher, saved.id, saved.version),
    ).rejects.toThrow('Injected after actual write');
    expect(failing.wrote()).toBe(true);
    expect(await allRows(saved.id)).toEqual(before);
  },
);

it.each(['APPROVE', 'REQUEST_CHANGES'] as const)(
  'rolls back %s after actual review and lesson writes',
  async (decision) => {
    const saved = await prepared();
    const submitted = await workflow().submit(teacher, saved.id, saved.version);
    const before = await allRows(saved.id);
    for (const stage of ['review', 'lesson'] as const) {
      const failing = failAfterWrite(stage);
      await expect(
        failing.service.review(admin, saved.id, submitted.revision.id, {
          expectedVersion: submitted.workflow.version,
          decision,
          feedback: 'Feedback',
        }),
      ).rejects.toThrow('Injected after actual write');
      expect(failing.wrote()).toBe(true);
      expect(await allRows(saved.id)).toEqual(before);
    }
  },
);

it('preserves full historical rows, retired snapshots, origin and provenance through feedback, refresh, resubmission and approval', async () => {
  const saved = await prepared();
  // Server-controlled provenance fixture, never accepted from a client save.
  await db.lesson.update({
    where: { id: saved.id },
    data: { draftGenerationOrigin: 'AI_ASSISTED' },
  });
  const selected = saved.sources[0]!;
  await resources.mutate(
    'ADMIN',
    selected.resourceId,
    selected.resourceVersion,
    { ...content, contentText: 'Changed after selection.' },
  );
  const retired = saved.sources[1]!;
  await resources.mutate('ADMIN', retired.resourceId, retired.resourceVersion);
  const first = await workflow().submit(teacher, saved.id, saved.version);
  expect(first.revision.generationOrigin).toBe('AI_ASSISTED');
  expect(first.revision.sources).toEqual(
    [...saved.sources].sort((a, b) => a.resourceId.localeCompare(b.resourceId)),
  );
  const rejected = await workflow().review(admin, saved.id, first.revision.id, {
    expectedVersion: first.workflow.version,
    decision: 'REQUEST_CHANGES',
    feedback: '  Explain equal parts.  ',
  });
  expect(rejected.revision.review?.feedback).toBe('Explain equal parts.');
  const historical = (await allRows(saved.id)).revisions[0]!;
  let editable = await lessons.detail(teacher, saved.id);
  expect(editable.sources).toEqual(first.revision.sources);
  expect(editable.generationOrigin).toBe('AI_ASSISTED');
  editable = await lessons.mutate(teacher, saved.id, editable.version, {
    action: 'refresh',
    resourceId: selected.resourceId,
  });
  editable = await lessons.mutate(teacher, saved.id, editable.version, {
    content: { ...completeContent, title: 'Revised equal parts' },
  });
  expect((await allRows(saved.id)).revisions[0]).toEqual(historical);
  const second = await workflow().submit(teacher, saved.id, editable.version);
  expect(second.revision.number).toBe(2);
  expect(second.revision.generationOrigin).toBe('AI_ASSISTED');
  expect(
    second.revision.sources.find((s) => s.resourceId === selected.resourceId)
      ?.resourceVersion,
  ).toBe(selected.resourceVersion + 1);
  expect(
    second.revision.sources.find((s) => s.resourceId === retired.resourceId),
  ).toEqual(retired);
  // Supplying a fresh version must not permit reviewing an older revision.
  await expect(
    workflow().review(admin, saved.id, first.revision.id, {
      expectedVersion: second.workflow.version,
      decision: 'APPROVE',
    }),
  ).rejects.toMatchObject({ status: 409 });
  const secondBefore = (await allRows(saved.id)).revisions[1]!;
  const approved = await workflow().review(
    admin,
    saved.id,
    second.revision.id,
    {
      expectedVersion: second.workflow.version,
      decision: 'APPROVE',
      feedback: '  ',
    },
  );
  expect(approved.revision.review?.feedback).toBeNull();
  expect(approved.workflow.state).toBe('APPROVED');
  const final = await allRows(saved.id);
  expect(final.revisions[0]).toEqual(historical);
  expect({ ...final.revisions[1], review: null }).toEqual(secondBefore);
  expect(final.ownerId).toBe(teacher.id);
  expect(final.copiedFromRevisionId).toBeNull();
  expect(final.draftContent).toBeNull();
  expect(final.draftGenerationOrigin).toBeNull();
  expect(final.currentRevisionId).toBe(second.revision.id);
  // Lost first-submission response: exact history remains readable after later review/resubmission.
  const recovered = await workflow().detail(
    teacher,
    saved.id,
    first.revision.id,
  );
  expect(recovered.revision.content).toEqual(first.revision.content);
  expect(recovered.revision.sources).toEqual(first.revision.sources);
  expect(recovered.revision.review).toEqual(rejected.revision.review);
  expect(recovered.workflow).toEqual(approved.workflow);
  const history = await workflow().history(admin, saved.id, 1);
  const page2 = await workflow().history(
    admin,
    saved.id,
    1,
    history.nextAfter!,
  );
  expect(page2.nextAfter).toBeNull();
  expect([...history.items, ...page2.items].map((r) => r.id)).toEqual(
    [first.revision.id, second.revision.id].sort(),
  );
  expect(history.items[0]).not.toHaveProperty('content');
  expect(history.items[0]).not.toHaveProperty('sources');
  expect(
    (await workflow().pending(admin, 50)).items.some(
      (item) => item.workflow.lessonId === saved.id,
    ),
  ).toBe(false);
  expect(await allRows(saved.id)).toEqual(final);
});

it.each(['history', 'detail', 'pending'] as const)(
  'keeps %s multi-query reads in one read-only repeatable snapshot during review and resubmission',
  async (operation) => {
    const saved = await prepared();
    const submitted = await workflow().submit(teacher, saved.id, saved.version);
    let reached!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let paused = false;
    const client = {
      $transaction: (
        run: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options: object,
      ) =>
        db.$transaction(async (tx) => {
          const wrapped = new Proxy(tx, {
            get(target, key) {
              const model = Reflect.get(target, key);
              if (key !== 'lesson') return model;
              return new Proxy(model as object, {
                get(delegate, method) {
                  const original = Reflect.get(delegate, method);
                  if (
                    method !==
                    (operation === 'pending' ? 'findMany' : 'findFirst')
                  )
                    return original;
                  return async (...args: unknown[]) => {
                    const value = await Reflect.apply(
                      original as (...input: unknown[]) => unknown,
                      delegate,
                      args,
                    );
                    if (!paused) {
                      paused = true;
                      const flags = await tx.$queryRaw<
                        { readOnly: string; isolation: string }[]
                      >`SELECT current_setting('transaction_read_only') AS "readOnly", current_setting('transaction_isolation') AS isolation`;
                      expect(flags[0]?.readOnly).toBe('on');
                      expect(flags[0]?.isolation).toBe('repeatable read');
                      reached();
                      await gate;
                    }
                    return value;
                  };
                },
              });
            },
          });
          return run(wrapped);
        }, options),
    } as unknown as PrismaClient;
    const reader = new LessonWorkflowService(client);
    const reading =
      operation === 'history'
        ? reader.history(admin, saved.id, 50)
        : operation === 'detail'
          ? reader.detail(admin, saved.id, submitted.revision.id)
          : reader.pending(admin, 50);
    let newer: Awaited<ReturnType<LessonWorkflowService['submit']>> | undefined;
    try {
      await Promise.race([
        ready,
        reading.then(() => {
          throw new Error('Read did not pause.');
        }),
      ]);
      const requested = await competingWorkflow().review(
        admin,
        saved.id,
        submitted.revision.id,
        {
          expectedVersion: submitted.workflow.version,
          decision: 'REQUEST_CHANGES',
          feedback: 'Explain.',
        },
      );
      const edited = await competitor.mutate(
        teacher,
        saved.id,
        requested.workflow.version,
        { content: { ...completeContent, title: 'Later revision' } },
      );
      newer = await competingWorkflow().submit(
        teacher,
        saved.id,
        edited.version,
      );
    } finally {
      release();
      await Promise.allSettled([reading]);
    }
    const result = await reading;
    if ('workflow' in result)
      expect(result.workflow).toEqual(submitted.workflow);
    if ('revision' in result)
      expect(result.revision).toEqual(submitted.revision);
    if ('items' in result && 'workflow' in result) {
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: submitted.revision.id,
        review: null,
      });
    }
    if ('items' in result && !('workflow' in result)) {
      expect(
        result.items.find((item) => item.workflow.lessonId === saved.id),
      ).toEqual({
        workflow: submitted.workflow,
        revision: {
          id: submitted.revision.id,
          number: 1,
          title: completeContent.title,
          generationOrigin: 'MANUAL',
          submittedAt: submitted.revision.submittedAt,
          review: null,
        },
      });
    }
    expect(
      (await workflow().detail(admin, saved.id, submitted.revision.id))
        .workflow,
    ).toEqual(newer!.workflow);
  },
);

it('paginates pending lessons by exclusive lesson UUID and excludes drafts and reviewed current revisions', async () => {
  const all = await workflow().pending(admin, 50);
  const ids = all.items.map((item) => item.workflow.lessonId);
  expect(ids.length).toBeGreaterThan(1);
  expect(ids).toEqual([...ids].sort());
  const seen: string[] = [];
  let after: string | undefined;
  do {
    const page = await workflow().pending(admin, 1, after);
    for (const item of page.items) {
      expect(item.workflow.state).toBe('SUBMITTED');
      expect(item.revision.review).toBeNull();
      expect(item.revision).not.toHaveProperty('content');
      seen.push(item.workflow.lessonId);
    }
    after = page.nextAfter ?? undefined;
  } while (after);
  expect(seen).toEqual(ids);
  const unknownCursor = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  expect((await workflow().pending(admin, 1, unknownCursor)).items).toEqual([]);
});

it.each(['SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED'] as const)(
  'returns 404 without any writes for unknown/cross-lesson review targets at fresh/stale versions in %s',
  async (state) => {
    const saved = await prepared();
    const otherSaved = await prepared();
    const submitted = await workflow().submit(teacher, saved.id, saved.version);
    const cross = await workflow().submit(
      teacher,
      otherSaved.id,
      otherSaved.version,
    );
    let version = submitted.workflow.version;
    if (state !== 'SUBMITTED') {
      const decided = await workflow().review(
        admin,
        saved.id,
        submitted.revision.id,
        {
          expectedVersion: version,
          decision: state === 'APPROVED' ? 'APPROVE' : 'REQUEST_CHANGES',
          feedback: 'Retained review feedback.',
        },
      );
      version = decided.workflow.version;
    }
    const before = await allRows(saved.id);
    const otherBefore = await allRows(otherSaved.id);
    for (const revisionId of [randomUUID(), cross.revision.id]) {
      for (const expectedVersion of [version, version - 1]) {
        await expect(
          workflow().review(admin, saved.id, revisionId, {
            expectedVersion,
            decision: 'APPROVE',
          }),
        ).rejects.toMatchObject({ status: 404 });
        expect(await allRows(saved.id)).toEqual(before);
        expect(await allRows(otherSaved.id)).toEqual(otherBefore);
      }
    }
    // Membership succeeds for the exact same-lesson revision: conflicts stay 409.
    for (const expectedVersion of state === 'SUBMITTED'
      ? [version - 1]
      : [version, version - 1]) {
      await expect(
        workflow().review(admin, saved.id, submitted.revision.id, {
          expectedVersion,
          decision: 'APPROVE',
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await allRows(saved.id)).toEqual(before);
    }
  },
);
