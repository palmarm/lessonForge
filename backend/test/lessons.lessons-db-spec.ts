import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { createDatabaseClient } from '../src/prisma/prisma.service.js';
import { LessonsService } from '../src/lessons/lessons.service.js';
import { LessonWorkflowService } from '../src/lessons/lesson-workflow.service.js';
import { LibraryService } from '../src/lessons/library.service.js';
import { completeContent } from './support/submission-content.js';
import { ResourcesService } from '../src/resources/resources.service.js';
import { resourceInput } from '../src/resources/resources.input.js';
import { resolveConstraintDatabaseUrl } from './support/constraint-database.js';
import { initializeConstraintDatabase } from './support/constraint-preflight.js';

const library = () => new LibraryService(db);
const otherLibrary = () => new LibraryService(other);
async function approvedSource(origin: 'MANUAL' | 'AI_ASSISTED' = 'MANUAL') {
  const saved = await prepared();
  // Server-side provenance fixture; no AI provider or client-controlled origin.
  if (origin === 'AI_ASSISTED')
    await db.lesson.update({
      where: { id: saved.id },
      data: { draftGenerationOrigin: origin },
    });
  const submitted = await workflow().submit(teacher, saved.id, saved.version);
  return workflow().review(admin, saved.id, submitted.revision.id, {
    expectedVersion: submitted.workflow.version,
    decision: 'APPROVE',
    feedback: 'Private reviewer feedback',
  });
}
function requestCopy(
  source: Awaited<ReturnType<typeof approvedSource>>,
  operationKey = randomUUID(),
) {
  return {
    lessonId: source.workflow.lessonId,
    revisionId: source.revision.id,
    body: { operationKey, expectedVersion: source.workflow.version },
  };
}

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
        // This fixture is later approved, so it must also satisfy library validity.
        content: completeContent,
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

it('library exposes only approved current revisions to both roles without author/reviewer/feedback expansions', async () => {
  const approved = await approvedSource();
  const incomplete = await draft();
  const pendingDraft = await prepared();
  const pending = await workflow().submit(
    teacher,
    pendingDraft.id,
    pendingDraft.version,
  );
  const changesDraft = await prepared();
  const changesSubmission = await workflow().submit(
    teacher,
    changesDraft.id,
    changesDraft.version,
  );
  const changes = await workflow().review(
    admin,
    changesDraft.id,
    changesSubmission.revision.id,
    {
      expectedVersion: changesSubmission.workflow.version,
      decision: 'REQUEST_CHANGES',
      feedback: 'Private changes',
    },
  );
  for (const actor of [teacher, foreign, admin]) {
    const detail = await library().detail(
      actor,
      approved.workflow.lessonId,
      approved.revision.id,
    );
    expect(Object.keys(detail).sort()).toEqual([
      'approvedAt',
      'revision',
      'workflow',
    ]);
    expect(Object.keys(detail.revision).sort()).toEqual([
      'content',
      'generationOrigin',
      'id',
      'number',
      'sources',
      'submittedAt',
    ]);
    expect(detail.revision.content).toEqual(approved.revision.content);
    expect(detail.revision.sources).toEqual(approved.revision.sources);
    expect(detail.approvedAt).toEqual(approved.revision.review!.decidedAt);
    for (const hidden of [
      { lessonId: incomplete.id, revisionId: randomUUID() },
      { lessonId: pending.workflow.lessonId, revisionId: pending.revision.id },
      { lessonId: changes.workflow.lessonId, revisionId: changes.revision.id },
      { lessonId: approved.workflow.lessonId, revisionId: pending.revision.id },
    ])
      await expect(
        library().detail(actor, hidden.lessonId, hidden.revisionId),
      ).rejects.toMatchObject({ status: 404 });
  }
  // A shared-library read must not expand the existing private history permission.
  await expect(
    workflow().history(foreign, approved.workflow.lessonId, 20),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    lessons.detail(foreign, approved.workflow.lessonId),
  ).rejects.toMatchObject({ status: 404 });
  const listed = await library().list(foreign, 50);
  expect(
    listed.items.some(
      (item) => item.workflow.lessonId === approved.workflow.lessonId,
    ),
  ).toBe(true);
  for (const id of [incomplete.id, pendingDraft.id, changesDraft.id])
    expect(listed.items.some((item) => item.workflow.lessonId === id)).toBe(
      false,
    );
  for (const item of listed.items)
    expect(Object.keys(item.revision).sort()).toEqual([
      'generationOrigin',
      'id',
      'number',
      'submittedAt',
      'title',
    ]);
});

it('paginates the approved library by exclusive lesson UUID with bounded coherent pages', async () => {
  await approvedSource();
  const all = await library().list(teacher, 50);
  expect(all.items.length).toBeGreaterThan(1);
  const seen: string[] = [];
  let after: string | undefined;
  do {
    const page = await library().list(teacher, 1, after);
    for (const item of page.items) seen.push(item.workflow.lessonId);
    after = page.nextAfter ?? undefined;
  } while (after);
  expect(seen).toEqual(all.items.map((item) => item.workflow.lessonId));
  expect(seen).toEqual([...seen].sort());
  expect(
    await library().list(teacher, 1, 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  ).toEqual({ items: [], nextAfter: null });
});

it.each(['MANUAL', 'AI_ASSISTED'] as const)(
  'copies exact %s content and old/retired snapshots; source rows stay unchanged through independent review',
  async (origin) => {
    const source = await approvedSource(origin);
    const before = await allRows(source.workflow.lessonId);
    const first = source.revision.sources[0]!;
    const second = source.revision.sources[1]!;
    await resources.mutate('ADMIN', first.resourceId, first.resourceVersion, {
      ...content,
      contentText: 'Newer resource text',
    });
    await resources.mutate('ADMIN', second.resourceId, second.resourceVersion);
    const request = requestCopy(source);
    const copied = await library().copy(
      foreign,
      request.lessonId,
      request.revisionId,
      request.body,
    );
    expect(copied.created).toBe(true);
    const id = copied.result.operation.destinationLessonId;
    const rows = await allRows(id);
    expect(rows.ownerId).toBe(foreign.id);
    expect(rows.version).toBe(1);
    expect(rows.currentRevisionId).toBeNull();
    expect(rows.copiedFromRevisionId).toBe(source.revision.id);
    expect(rows.copyOperationKey).toBe(request.body.operationKey);
    expect(rows.copySourceVersion).toBe(request.body.expectedVersion);
    expect(rows.revisions).toEqual([]);
    let editable = await lessons.detail(foreign, id);
    expect(editable.content).toEqual(source.revision.content);
    expect(editable.sources).toEqual(source.revision.sources);
    expect(editable.generationOrigin).toBe(origin);
    await expect(lessons.detail(teacher, id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      lessons.mutate(foreign, id, 1, {
        action: 'refresh',
        resourceId: second.resourceId,
      }),
    ).rejects.toMatchObject({ status: 409 });
    editable = await lessons.mutate(foreign, id, 1, {
      content: editable.content,
    });
    expect(editable.sources).toEqual(source.revision.sources);
    const submitted = await workflow().submit(foreign, id, editable.version);
    expect(submitted.revision.number).toBe(1);
    expect(submitted.revision.review).toBeNull();
    expect(submitted.revision.sources).toEqual(source.revision.sources);
    expect(submitted.revision.generationOrigin).toBe(origin);
    expect(submitted.workflow.state).toBe('SUBMITTED');
    expect(await allRows(source.workflow.lessonId)).toEqual(before);
  },
);

it('recovers a committed lost response with the same key after edit, submit, requested changes, resubmission and approval', async () => {
  const source = await approvedSource();
  const request = requestCopy(source);
  // Commit the service operation, then discard its transport result.
  await library().copy(
    foreign,
    request.lessonId,
    request.revisionId,
    request.body,
  );
  const recovered = await otherLibrary().recover(
    foreign,
    request.body.operationKey,
  );
  const id = recovered.operation.destinationLessonId;
  const replay = async () => {
    const before = await allRows(id);
    expect(
      await otherLibrary().copy(
        foreign,
        request.lessonId,
        request.revisionId,
        request.body,
      ),
    ).toEqual({ created: false, result: recovered });
    expect(await library().recover(foreign, request.body.operationKey)).toEqual(
      recovered,
    );
    expect(await allRows(id)).toEqual(before);
    expect(Object.keys(recovered)).toEqual(['operation']);
  };
  await replay();
  const edited = await lessons.mutate(foreign, id, 1, {
    content: { ...completeContent, title: 'Edited destination' },
  });
  await replay();
  expect((await lessons.detail(foreign, id)).content.title).toBe(
    'Edited destination',
  );
  const submitted = await workflow().submit(foreign, id, edited.version);
  await replay();
  await expect(lessons.detail(foreign, id)).rejects.toMatchObject({
    status: 409,
  });
  const changes = await workflow().review(admin, id, submitted.revision.id, {
    expectedVersion: submitted.workflow.version,
    decision: 'REQUEST_CHANGES',
    feedback: 'Revise independently',
  });
  await replay();
  const next = await workflow().submit(foreign, id, changes.workflow.version);
  await workflow().review(admin, id, next.revision.id, {
    expectedVersion: next.workflow.version,
    decision: 'APPROVE',
  });
  await replay();
  expect((await workflow().history(foreign, id, 20)).workflow.state).toBe(
    'APPROVED',
  );
  expect(
    await db.lesson.count({
      where: {
        ownerId: foreign.id,
        copyOperationKey: request.body.operationKey,
      },
    }),
  ).toBe(1);
});

it('binds successful keys to every source parameter, isolates teachers, and permits new-key intentional copies', async () => {
  const source = await approvedSource();
  const another = await approvedSource();
  const request = requestCopy(source);
  const original = await library().copy(
    foreign,
    request.lessonId,
    request.revisionId,
    request.body,
  );
  const before = await allRows(original.result.operation.destinationLessonId);
  for (const [lessonId, revisionId, body] of [
    [another.workflow.lessonId, request.revisionId, request.body],
    [request.lessonId, another.revision.id, request.body],
    [
      request.lessonId,
      request.revisionId,
      { ...request.body, expectedVersion: request.body.expectedVersion - 1 },
    ],
    [
      another.workflow.lessonId,
      another.revision.id,
      { ...request.body, expectedVersion: another.workflow.version },
    ],
  ] as const)
    await expect(
      library().copy(foreign, lessonId, revisionId, body),
    ).rejects.toMatchObject({ status: 409 });
  expect(await allRows(before.id)).toEqual(before);
  await expect(
    library().recover(teacher, request.body.operationKey),
  ).rejects.toMatchObject({ status: 404 });
  const isolated = await library().copy(
    teacher,
    request.lessonId,
    request.revisionId,
    request.body,
  );
  const intentional = await library().copy(
    foreign,
    request.lessonId,
    request.revisionId,
    { ...request.body, operationKey: randomUUID() },
  );
  expect(
    new Set(
      [original, isolated, intentional].map(
        (result) => result.result.operation.destinationLessonId,
      ),
    ).size,
  ).toBe(3);
  await expect(
    library().copy(admin, request.lessonId, request.revisionId, request.body),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    library().recover(admin, request.body.operationKey),
  ).rejects.toMatchObject({ status: 403 });
});

it('rejects invalid, stale and ineligible copy requests without reserving the key or inserting a destination', async () => {
  const source = await approvedSource();
  const incomplete = await draft();
  const pendingDraft = await prepared();
  const pending = await workflow().submit(
    teacher,
    pendingDraft.id,
    pendingDraft.version,
  );
  const changed = await workflow().review(
    admin,
    pendingDraft.id,
    pending.revision.id,
    {
      expectedVersion: pending.workflow.version,
      decision: 'REQUEST_CHANGES',
      feedback: 'Not approved',
    },
  );
  const key = randomUUID();
  const count = await db.lesson.count();
  for (const [lessonId, revisionId, expectedVersion, status] of [
    [
      source.workflow.lessonId,
      source.revision.id,
      source.workflow.version - 1,
      409,
    ],
    [incomplete.id, randomUUID(), 1, 404],
    [
      changed.workflow.lessonId,
      changed.revision.id,
      changed.workflow.version,
      404,
    ],
    [
      source.workflow.lessonId,
      changed.revision.id,
      source.workflow.version,
      404,
    ],
    [randomUUID(), source.revision.id, 1, 404],
  ] as const)
    await expect(
      library().copy(foreign, lessonId, revisionId, {
        operationKey: key,
        expectedVersion,
      }),
    ).rejects.toMatchObject({ status });
  await expect(
    library().copy(foreign, source.workflow.lessonId, source.revision.id, {
      operationKey: key,
      expectedVersion: source.workflow.version,
      content: {},
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect(await db.lesson.count()).toBe(count);
  await expect(library().recover(foreign, key)).rejects.toMatchObject({
    status: 404,
  });
  expect(
    (
      await library().copy(
        foreign,
        source.workflow.lessonId,
        source.revision.id,
        { operationKey: key, expectedVersion: source.workflow.version },
      )
    ).created,
  ).toBe(true);
});

function copyGate(stage: 'operation' | 'source' | 'insert') {
  let release!: () => void, ready!: (pid: number) => void;
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
        const pause = async () => {
          const [{ pid }] = await tx.$queryRaw<
            { pid: number }[]
          >`SELECT pg_backend_pid() AS pid`;
          ready(pid!);
          await gate;
        };
        const wrapped = new Proxy(tx, {
          get(target, name) {
            if (name === '$queryRaw')
              return async (...args: unknown[]) => {
                const result = await Reflect.apply(
                  target.$queryRaw,
                  target,
                  args,
                );
                const sql = (args[0] as TemplateStringsArray).join('');
                if (
                  (stage === 'operation' &&
                    sql.includes('pg_advisory_xact_lock')) ||
                  (stage === 'source' && sql.includes('FOR UPDATE'))
                )
                  await pause();
                return result;
              };
            if (name === 'lesson' && stage === 'insert')
              return new Proxy(target.lesson, {
                get(delegate, method) {
                  if (method !== 'create') return Reflect.get(delegate, method);
                  return async (...args: unknown[]) => {
                    const result = await Reflect.apply(
                      Reflect.get(delegate, method),
                      delegate,
                      args,
                    );
                    await pause();
                    return result;
                  };
                },
              });
            return Reflect.get(target, name);
          },
        });
        return run(wrapped);
      }, options),
  } as unknown as PrismaClient;
  return { client, locked, release };
}
async function waitForCopyLock(pid: number, sql: string) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const rows = await other.$queryRaw<{ waiting: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND ${pid} = ANY(pg_blocking_pids(pid)) AND query LIKE ${sql}) AS waiting
    `;
    if (rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Copy lock contention was not observed.');
}

it.each(['matching', 'mismatched'] as const)(
  'observes same-key %s requests waiting for a real inserted, uncommitted copy',
  async (kind) => {
    const source = await approvedSource();
    const request = requestCopy(source);
    const before = await allRows(source.workflow.lessonId);
    const gate = copyGate('insert');
    const holding = new LibraryService(gate.client).copy(
      foreign,
      request.lessonId,
      request.revisionId,
      request.body,
    );
    let pending:
      | Promise<
          PromiseSettledResult<Awaited<ReturnType<LibraryService['copy']>>>[]
        >
      | undefined;
    try {
      const pid = await Promise.race([
        gate.locked,
        holding.then(() => {
          throw new Error('Insert gate not reached');
        }),
      ]);
      let settled = false;
      pending = Promise.allSettled([
        otherLibrary().copy(foreign, request.lessonId, request.revisionId, {
          ...request.body,
          expectedVersion:
            request.body.expectedVersion - (kind === 'mismatched' ? 1 : 0),
        }),
      ]).finally(() => {
        settled = true;
      });
      await waitForCopyLock(pid, '%pg_advisory_xact_lock%');
      expect(settled).toBe(false);
      // Uncommitted identity/destination must not be falsely reported as successful.
      await expect(
        otherLibrary().recover(foreign, request.body.operationKey),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      gate.release();
      await Promise.allSettled([holding, ...(pending ? [pending] : [])]);
    }
    const first = await holding;
    const [second] = await pending!;
    expect(first.created).toBe(true);
    if (kind === 'matching') {
      expect(second!.status).toBe('fulfilled');
      if (second!.status === 'fulfilled')
        expect(second!.value).toEqual({ created: false, result: first.result });
    } else {
      expect(second!.status).toBe('rejected');
      if (second!.status === 'rejected')
        expect(second!.reason).toMatchObject({ status: 409 });
    }
    expect(
      await db.lesson.count({
        where: {
          ownerId: foreign.id,
          copyOperationKey: request.body.operationKey,
        },
      }),
    ).toBe(1);
    expect(await allRows(source.workflow.lessonId)).toEqual(before);
  },
);

it('observes different-key copies contending on the source lesson and creates two intentional destinations', async () => {
  const source = await approvedSource();
  const request = requestCopy(source);
  const gate = copyGate('source');
  const holding = new LibraryService(gate.client).copy(
    foreign,
    request.lessonId,
    request.revisionId,
    request.body,
  );
  let pending: Promise<Awaited<ReturnType<LibraryService['copy']>>> | undefined;
  try {
    const pid = await Promise.race([
      gate.locked,
      holding.then(() => {
        throw new Error('Source gate not reached');
      }),
    ]);
    pending = otherLibrary().copy(
      foreign,
      request.lessonId,
      request.revisionId,
      { ...request.body, operationKey: randomUUID() },
    );
    await waitForCopyLock(pid, '%FROM "Lesson"%FOR UPDATE%');
  } finally {
    gate.release();
    await Promise.allSettled([holding, ...(pending ? [pending] : [])]);
  }
  const first = await holding,
    second = await pending!;
  expect(first.created).toBe(true);
  expect(second.created).toBe(true);
  expect(first.result.operation.destinationLessonId).not.toBe(
    second.result.operation.destinationLessonId,
  );
});

it('rolls back the actual destination/identity insert and lets a waiting same-key request create the sole committed copy', async () => {
  const source = await approvedSource();
  const request = requestCopy(source);
  const before = await allRows(source.workflow.lessonId);
  const gate = copyGate('insert');
  let wrote = false;
  const failing = new LibraryService({
    $transaction: (
      run: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: object,
    ) =>
      gate.client.$transaction(async (tx) => {
        await run(tx);
        wrote = true;
        throw new Error('Injected after actual copy insert');
      }, options),
  } as unknown as PrismaClient);
  const holding = failing.copy(
    foreign,
    request.lessonId,
    request.revisionId,
    request.body,
  );
  // Handle the injected rejection immediately while the waiter is observed.
  const failure = expect(holding).rejects.toThrow(
    'Injected after actual copy insert',
  );
  let pending: Promise<Awaited<ReturnType<LibraryService['copy']>>> | undefined;
  try {
    const pid = await Promise.race([
      gate.locked,
      holding.then(() => {
        throw new Error('Insert gate not reached');
      }),
    ]);
    pending = otherLibrary().copy(
      foreign,
      request.lessonId,
      request.revisionId,
      request.body,
    );
    await waitForCopyLock(pid, '%pg_advisory_xact_lock%');
  } finally {
    gate.release();
    await Promise.allSettled([failure, ...(pending ? [pending] : [])]);
  }
  await failure;
  expect(wrote).toBe(true);
  const committed = await pending!;
  expect(committed.created).toBe(true);
  expect(
    await db.lesson.count({
      where: {
        ownerId: foreign.id,
        copyOperationKey: request.body.operationKey,
      },
    }),
  ).toBe(1);
  expect(await library().recover(foreign, request.body.operationKey)).toEqual(
    committed.result,
  );
  expect(await allRows(source.workflow.lessonId)).toEqual(before);
});

it('rolls back an actual insert without a waiter, leaving no mapping or orphan destination', async () => {
  const source = await approvedSource();
  const request = requestCopy(source);
  const before = await db.lesson.findMany({ orderBy: { id: 'asc' } });
  let insertedId: string | undefined;
  const failing = new LibraryService({
    $transaction: (
      run: (
        tx: Prisma.TransactionClient,
      ) => Promise<{ result: { operation: { destinationLessonId: string } } }>,
      options: object,
    ) =>
      db.$transaction(async (tx) => {
        const result = await run(tx);
        insertedId = result.result.operation.destinationLessonId;
        expect(
          await tx.lesson.findUnique({ where: { id: insertedId } }),
        ).not.toBeNull();
        throw new Error('Injected after actual insert');
      }, options),
  } as unknown as PrismaClient);
  await expect(
    failing.copy(foreign, request.lessonId, request.revisionId, request.body),
  ).rejects.toThrow('Injected after actual insert');
  expect(insertedId).toBeDefined();
  expect(await db.lesson.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  expect(await db.lesson.findUnique({ where: { id: insertedId! } })).toBeNull();
  await expect(
    library().recover(foreign, request.body.operationKey),
  ).rejects.toMatchObject({ status: 404 });
  expect(
    (
      await library().copy(
        foreign,
        request.lessonId,
        request.revisionId,
        request.body,
      )
    ).created,
  ).toBe(true);
});

it('database protects operation identity, successful mapping retention, format, pair consistency and actor-scoped uniqueness', async () => {
  const source = await approvedSource();
  const request = requestCopy(source);
  const copied = await library().copy(
    foreign,
    request.lessonId,
    request.revisionId,
    request.body,
  );
  const id = copied.result.operation.destinationLessonId;
  const before = await allRows(id);
  // No incoming revision FK exists yet: rejection must come from identity protection.
  expect(before.currentRevisionId).toBeNull();
  expect(before.revisions).toEqual([]);
  const replacementId = randomUUID();
  let failure: { code?: string; message?: string } | undefined;
  try {
    await db.$executeRaw`UPDATE "Lesson" SET id = ${replacementId}::uuid WHERE id = ${id}::uuid`;
  } catch (error) {
    // The adapter retains SQLSTATE/message but omits the native constraint name.
    const meta = (
      error as {
        meta?: {
          code?: string;
          message?: string;
          driverAdapterError?: {
            cause?: { originalCode?: string; originalMessage?: string };
          };
        };
      }
    ).meta;
    const cause = meta?.driverAdapterError?.cause;
    failure = {
      code: cause?.originalCode ?? meta?.code,
      message: cause?.originalMessage ?? meta?.message,
    };
  }
  expect(failure).toEqual({
    code: '23514',
    message: 'Successful copy destination identity is write-once.',
  });
  await expect(
    db.lesson.update({ where: { id }, data: { id: replacementId } }),
  ).rejects.toThrow('Successful copy destination identity is write-once.');
  expect(await allRows(id)).toEqual(before);
  expect(
    await db.lesson.findUnique({ where: { id: replacementId } }),
  ).toBeNull();
  expect(before).toMatchObject({
    id,
    ownerId: foreign.id,
    copyOperationKey: request.body.operationKey,
    copiedFromRevisionId: source.revision.id,
    copySourceVersion: request.body.expectedVersion,
  });
  expect(
    await library().copy(
      foreign,
      request.lessonId,
      request.revisionId,
      request.body,
    ),
  ).toEqual({ created: false, result: copied.result });
  expect(await library().recover(foreign, request.body.operationKey)).toEqual(
    copied.result,
  );
  for (const data of [
    { copyOperationKey: randomUUID() },
    { copyOperationKey: null },
    { copySourceVersion: source.workflow.version + 1 },
    { copiedFromRevisionId: null },
    { ownerId: teacher.id },
  ])
    await expect(db.lesson.update({ where: { id }, data })).rejects.toThrow();
  await expect(db.lesson.delete({ where: { id } })).rejects.toThrow();
  for (const data of [
    { copyOperationKey: randomUUID() },
    { copySourceVersion: 1 },
    {
      copyOperationKey: randomUUID(),
      copySourceVersion: 0,
      copiedFromRevisionId: source.revision.id,
    },
    {
      copyOperationKey: '11111111-1111-1111-8111-111111111111',
      copySourceVersion: 1,
      copiedFromRevisionId: source.revision.id,
    },
    {
      copyOperationKey: request.body.operationKey,
      copySourceVersion: source.workflow.version,
      copiedFromRevisionId: source.revision.id,
    },
  ])
    await expect(
      db.lesson.create({ data: { ownerId: foreign.id, ...data } }),
    ).rejects.toThrow();
  expect(await allRows(id)).toEqual(before);
  const edited = await lessons.mutate(foreign, id, before.version, {
    content: { ...completeContent, title: 'Editable copied draft' },
  });
  expect(edited.content.title).toBe('Editable copied draft');
  expect(edited.version).toBe(before.version + 1);
  expect(await library().recover(foreign, request.body.operationKey)).toEqual(
    copied.result,
  );
});

it('keeps library multi-query reads read-only and repeatable while another lesson becomes approved', async () => {
  const saved = await prepared();
  const submitted = await workflow().submit(teacher, saved.id, saved.version);
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let paused = false;
  const reader = new LibraryService({
    $transaction: (
      run: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: object,
    ) =>
      db.$transaction(async (tx) => {
        const wrapped = new Proxy(tx, {
          get(target, name) {
            if (name !== 'lesson') return Reflect.get(target, name);
            return new Proxy(target.lesson, {
              get(delegate, method) {
                const original = Reflect.get(delegate, method);
                if (method !== 'findMany') return original;
                return async (...args: unknown[]) => {
                  const value = await Reflect.apply(original, delegate, args);
                  if (!paused) {
                    paused = true;
                    const [flags] = await tx.$queryRaw<
                      { readOnly: string; isolation: string }[]
                    >`SELECT current_setting('transaction_read_only') AS "readOnly", current_setting('transaction_isolation') AS isolation`;
                    expect(flags).toEqual({
                      readOnly: 'on',
                      isolation: 'repeatable read',
                    });
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
  } as unknown as PrismaClient);
  const reading = reader.list(foreign, 50);
  try {
    await Promise.race([
      ready,
      reading.then(() => {
        throw new Error('Read gate not reached');
      }),
    ]);
    await competingWorkflow().review(admin, saved.id, submitted.revision.id, {
      expectedVersion: submitted.workflow.version,
      decision: 'APPROVE',
    });
  } finally {
    release();
    await Promise.allSettled([reading]);
  }
  expect(
    (await reading).items.some((item) => item.workflow.lessonId === saved.id),
  ).toBe(false);
  expect(
    (await library().list(foreign, 50)).items.some(
      (item) => item.workflow.lessonId === saved.id,
    ),
  ).toBe(true);
});
