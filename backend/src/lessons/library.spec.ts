import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { completeContent } from '../../test/support/submission-content.js';
import { copyInput, copyOperationKey } from './library.input.js';
import { LibraryService } from './library.service.js';

const teacher = {
  id: '11111111-1111-4111-8111-111111111111',
  role: 'TEACHER' as const,
};
const lessonId = '22222222-2222-4222-8222-222222222222';
const revisionId = '33333333-3333-4333-8333-333333333333';
const key = '44444444-4444-4444-8444-444444444444';
const destination = '55555555-5555-4555-8555-555555555555';
const input = { operationKey: key, expectedVersion: 7 };
const source = {
  resourceId: teacher.id,
  resourceVersion: 1,
  snapshot: {
    title: ' Old source ',
    subject: 'Mathematics',
    grade: 'Grade 4',
    sourceReference: 'Original citation',
    contentText: ' Old text ',
  },
};
const stamp = new Date('2026-11-05T00:00:00.000Z');

function fixture() {
  const events: string[] = [];
  const row = {
    id: lessonId,
    version: 7,
    currentRevisionId: revisionId,
    draftContent: null as unknown,
    draftGenerationOrigin: null as unknown,
    currentRevision: {
      id: revisionId,
      number: 2,
      content: structuredClone(completeContent),
      generationOrigin: 'AI_ASSISTED',
      submittedAt: stamp,
      sources: [source],
      review: { decision: 'APPROVE', decidedAt: stamp },
    },
  };
  const saved = {
    id: destination,
    copyOperationKey: key,
    copySourceVersion: 7,
    copiedFromRevisionId: revisionId,
    copiedFromRevision: { lessonId },
  };
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn((sql: TemplateStringsArray) => {
      events.push(
        sql.join('').includes('advisory') ? 'operation-lock' : 'source-lock',
      );
      return [{ id: lessonId }];
    }),
    lesson: {
      findUnique: vi.fn((): typeof saved | null => {
        events.push('operation');
        return null;
      }),
      findFirst: vi.fn((): typeof row | null => {
        events.push('source');
        return row;
      }),
      findMany: vi.fn().mockResolvedValue([row]),
      create: vi.fn(() => {
        events.push('insert');
        return saved;
      }),
    },
    lessonRevision: {
      findFirst: vi.fn().mockResolvedValue({ id: revisionId }),
    },
  };
  const transaction = vi.fn((run: (tx: unknown) => unknown, _options: object) =>
    run(tx),
  );
  const service = new LibraryService({
    $transaction: transaction,
  } as unknown as PrismaClient);
  return { service, tx, row, saved, events, transaction };
}

it('accepts only canonical lowercase UUIDv4 operation keys and exact copy bodies', () => {
  expect(copyOperationKey(key)).toBe(key);
  expect(copyInput(input)).toEqual(input);
  for (const operationKey of [
    null,
    2,
    '',
    'bad',
    key.replace('4444-8444', '1444-8444'),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'.toUpperCase(),
    ` ${key}`,
    key.replace('-8444-', '-7444-'),
  ])
    expect(() => copyInput({ ...input, operationKey })).toThrow();
  for (const body of [
    {},
    { ...input, ownerId: teacher.id },
    { ...input, content: {} },
    { ...input, sources: [] },
    { ...input, generationOrigin: 'MANUAL' },
    { ...input, copiedFromRevisionId: revisionId },
    ...[0, -1, 1.5, '7', 2147483648].map((expectedVersion) => ({
      ...input,
      expectedVersion,
    })),
  ])
    expect(() => copyInput(body)).toThrow();
});

it('checks roles before database access for browse, copy and recovery', async () => {
  const f = fixture();
  const admin = { ...teacher, role: 'ADMIN' as const };
  for (const action of [
    f.service.copy(admin, lessonId, revisionId, {}),
    f.service.recover(admin, key),
    f.service.list({ ...teacher, role: 'OTHER' as never }, 20),
  ])
    await expect(action).rejects.toMatchObject({ status: 403 });
  expect(f.transaction).not.toHaveBeenCalled();
});

it('copies exact immutable content, snapshots and origin with no source update', async () => {
  const f = fixture();
  const result = await f.service.copy(teacher, lessonId, revisionId, input);
  expect(f.events).toEqual([
    'operation-lock',
    'operation',
    'source-lock',
    'source',
    'insert',
  ]);
  expect(f.tx.lesson.create).toHaveBeenCalledWith({
    data: {
      ownerId: teacher.id,
      copiedFromRevisionId: revisionId,
      copyOperationKey: key,
      copySourceVersion: 7,
      draftGenerationOrigin: 'AI_ASSISTED',
      draftContent: { ...completeContent, sources: [source] },
    },
    select: expect.any(Object),
  });
  expect(result).toEqual({
    created: true,
    result: {
      operation: {
        key,
        source: { lessonId, revisionId, expectedVersion: 7 },
        destinationLessonId: destination,
      },
    },
  });
  expect(f.transaction.mock.calls[0]?.[1]).toEqual({
    maxWait: 5000,
    timeout: 5000,
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  });
});

it('replays the durable owned mapping before source checks and returns no mutable or creation content', async () => {
  const f = fixture();
  f.tx.lesson.findUnique.mockImplementation(() => {
    f.events.push('operation');
    return f.saved;
  });
  f.tx.lesson.findFirst.mockReturnValue(null);
  const result = await f.service.copy(teacher, lessonId, revisionId, input);
  expect(result.created).toBe(false);
  expect(result.result.operation.destinationLessonId).toBe(destination);
  expect(f.events).toEqual(['operation-lock', 'operation']);
  expect(f.tx.lesson.create).not.toHaveBeenCalled();
  expect(Object.keys(result.result)).toEqual(['operation']);
  expect(f.tx.lesson.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        ownerId_copyOperationKey: {
          ownerId: teacher.id,
          copyOperationKey: key,
        },
      },
    }),
  );
});

it.each(['lesson', 'revision', 'version'] as const)(
  'rejects same-key mismatched %s before source access',
  async (parameter) => {
    const f = fixture();
    f.tx.lesson.findUnique.mockImplementation(() => {
      f.events.push('operation');
      return f.saved;
    });
    await expect(
      f.service.copy(
        teacher,
        parameter === 'lesson' ? destination : lessonId,
        parameter === 'revision' ? destination : revisionId,
        { ...input, expectedVersion: parameter === 'version' ? 6 : 7 },
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.events).toEqual(['operation-lock', 'operation']);
    expect(f.tx.lesson.create).not.toHaveBeenCalled();
  },
);

it('rejects invisible sources before version conflicts; stale visible sources never insert', async () => {
  const f = fixture();
  f.tx.lesson.findFirst.mockReturnValueOnce(null);
  await expect(
    f.service.copy(teacher, lessonId, revisionId, {
      ...input,
      expectedVersion: 1,
    }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    f.service.copy(teacher, lessonId, revisionId, {
      ...input,
      expectedVersion: 1,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(f.tx.lesson.create).not.toHaveBeenCalled();
  expect(f.tx.lesson.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        id: lessonId,
        currentRevisionId: revisionId,
        currentRevision: { review: { decision: 'APPROVE' } },
      },
    }),
  );
});

it.each(['draft', 'latest', 'content', 'sources'])(
  'fails closed on invalid persisted %s without creating a copy',
  async (invariant) => {
    const f = fixture();
    if (invariant === 'draft') f.row.draftContent = {};
    if (invariant === 'latest')
      f.tx.lessonRevision.findFirst.mockResolvedValue({ id: destination });
    if (invariant === 'content')
      f.row.currentRevision.content.durationMinutes = 34;
    if (invariant === 'sources') f.row.currentRevision.sources = [];
    await expect(
      f.service.copy(teacher, lessonId, revisionId, input),
    ).rejects.toMatchObject({ status: 503 });
    expect(f.tx.lesson.create).not.toHaveBeenCalled();
  },
);

it('uses read-only repeatable snapshots and explicitly excludes identities, feedback and full content from summaries', async () => {
  const f = fixture();
  const page = await f.service.list(teacher, 1, destination);
  expect(f.tx.$executeRaw).toHaveBeenCalledOnce();
  expect(f.transaction.mock.calls[0]?.[1]).toEqual({
    maxWait: 5000,
    timeout: 5000,
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
  expect(f.tx.lesson.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        currentRevision: { review: { decision: 'APPROVE' } },
        id: { gt: destination },
      },
      orderBy: { id: 'asc' },
      take: 2,
    }),
  );
  expect(page.items[0]).toEqual({
    workflow: {
      lessonId,
      version: 7,
      state: 'APPROVED',
      currentRevisionId: revisionId,
    },
    revision: {
      id: revisionId,
      number: 2,
      title: completeContent.title,
      generationOrigin: 'AI_ASSISTED',
      submittedAt: stamp,
    },
    approvedAt: stamp,
  });
  const detail = await f.service.detail(
    { ...teacher, role: 'ADMIN' },
    lessonId,
    revisionId,
  );
  expect(detail.revision).toEqual({
    id: revisionId,
    number: 2,
    content: completeContent,
    generationOrigin: 'AI_ASSISTED',
    submittedAt: stamp,
    sources: [source],
  });
});

it('recovers only the authenticated teacher mapping; absent or foreign keys are 404', async () => {
  const f = fixture();
  await expect(f.service.recover(teacher, key)).rejects.toMatchObject({
    status: 404,
  });
  f.tx.lesson.findUnique.mockReturnValue(f.saved);
  expect(
    (await f.service.recover(teacher, key)).operation.destinationLessonId,
  ).toBe(destination);
  expect(f.tx.lesson.findUnique).toHaveBeenLastCalledWith(
    expect.objectContaining({
      where: {
        ownerId_copyOperationKey: {
          ownerId: teacher.id,
          copyOperationKey: key,
        },
      },
    }),
  );
  expect(f.tx.lesson.findFirst).not.toHaveBeenCalled();
});

it('propagates post-insert failure instead of reporting a successful operation', async () => {
  const f = fixture();
  f.tx.lesson.create.mockImplementationOnce(() => {
    throw new Error('failed insert');
  });
  await expect(
    f.service.copy(teacher, lessonId, revisionId, input),
  ).rejects.toThrow('failed insert');
});
