import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { completeContent } from '../../test/support/submission-content.js';
import {
  reviewInput,
  submissionContent,
  trustedSources,
} from './lesson-workflow.input.js';
import { LessonWorkflowService } from './lesson-workflow.service.js';

it('validates complete content without normalizing it; empty materials is valid', () => {
  expect(submissionContent(completeContent)).toEqual(completeContent);
});
it.each(Object.keys(completeContent))('requires submission field %s', (key) => {
  const content: Record<string, unknown> = { ...completeContent };
  delete content[key];
  expect(() => submissionContent(content)).toThrow();
});
it.each([
  { title: '  ' },
  { subject: 'English' },
  { grade: 'Grade 5' },
  { learningObjectives: [] },
  { learningObjectives: [' '] },
  { materials: null },
  { materials: [' '] },
  { introduction: {} },
  { introduction: { text: ' ', durationMinutes: 5 } },
  { activities: [] },
  { activities: [{}] },
  { activities: [{ ...completeContent.activities[0], teacherTasks: '' }] },
  { activities: [{ ...completeContent.activities[0], learnerTasks: '\t' }] },
  { assessment: { text: '', durationMinutes: 5 } },
  { differentiation: { learnerSupport: ' ', extensionActivities: 'x' } },
  { differentiation: { learnerSupport: 'x', extensionActivities: '' } },
  { durationMinutes: 34 },
  { durationMinutes: 0 },
  { durationMinutes: 1441 },
  { introduction: { text: 'x', durationMinutes: 0 } },
  { assessment: { text: 'x', durationMinutes: -1 } },
  {
    activities: [
      { teacherTasks: 'x', learnerTasks: 'y', durationMinutes: 1.5 },
    ],
  },
  { sources: [] },
  { title: '\0' },
])('rejects incomplete/invalid submission %j', (change) => {
  expect(() => submissionContent({ ...completeContent, ...change })).toThrow();
});
it('bounds raw feedback in UTF-16 units before trimming and normalizes approval blanks', () => {
  const base = { expectedVersion: 1, decision: 'APPROVE' };
  expect(reviewInput(base).feedback).toBeNull();
  expect(reviewInput({ ...base, feedback: null }).feedback).toBeNull();
  expect(reviewInput({ ...base, feedback: ' \n ' }).feedback).toBeNull();
  expect(reviewInput({ ...base, feedback: '  Thanks  ' }).feedback).toBe(
    'Thanks',
  );
  expect(
    reviewInput({ ...base, feedback: '😀'.repeat(2000) }).feedback?.length,
  ).toBe(4000);
  expect(() => reviewInput({ ...base, feedback: '😀'.repeat(2001) })).toThrow();
  expect(() =>
    reviewInput({ ...base, feedback: ' ' + 'x'.repeat(4000) }),
  ).toThrow();
});
it.each([
  {},
  { expectedVersion: 1, decision: 'REJECT' },
  { expectedVersion: 0, decision: 'APPROVE' },
  { expectedVersion: 1, decision: 'REQUEST_CHANGES' },
  ...[null, '', ' \n ', 4, 'x\0'].map((feedback) => ({
    expectedVersion: 1,
    decision: 'REQUEST_CHANGES',
    feedback,
  })),
  { expectedVersion: 1, decision: 'APPROVE', reviewerId: 'forged' },
])('rejects invalid review %j', (body) => {
  expect(() => reviewInput(body)).toThrow();
});
const source = {
  resourceId: '11111111-1111-4111-8111-111111111111',
  resourceVersion: 1,
  snapshot: {
    title: ' Source ',
    subject: 'Mathematics',
    grade: 'Grade 4',
    sourceReference: 'Original',
    contentText: 'Old text.',
  },
};
it('validates trusted stored sources without trimming or refreshing snapshots', () => {
  expect(trustedSources([source])).toEqual([source]);
  expect(trustedSources([])).toEqual([]);
});
it.each([
  null,
  {},
  [source, source],
  Array(6).fill(source),
  [{ ...source, resourceVersion: 0 }],
  [{ ...source, resourceId: 'bad' }],
  [{ ...source, snapshot: { ...source.snapshot, contentText: '' } }],
  [{ ...source, snapshot: { ...source.snapshot, extra: true } }],
])('fails closed on corrupt stored sources %j', (value) => {
  expect(() => trustedSources(value)).toThrow(
    expect.objectContaining({ status: 503 }),
  );
});
it('enforces service roles before any database work', async () => {
  const transaction = vi.fn();
  const service = new LessonWorkflowService({
    $transaction: transaction,
  } as unknown as PrismaClient);
  const teacher = { id: source.resourceId, role: 'TEACHER' as const };
  const admin = { ...teacher, role: 'ADMIN' as const };
  await expect(
    service.submit(admin, source.resourceId, 1),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.review(teacher, source.resourceId, source.resourceId, {}),
  ).rejects.toMatchObject({ status: 403 });
  await expect(service.pending(teacher, 20)).rejects.toMatchObject({
    status: 403,
  });
  expect(transaction).not.toHaveBeenCalled();
});
it('authorizes ownership before latest-state and version checks', async () => {
  const latest = vi.fn();
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: source.resourceId }]),
    lesson: { findFirst: vi.fn().mockResolvedValue(null) },
    lessonRevision: { findFirst: latest },
  };
  const service = new LessonWorkflowService({
    $transaction: (run: (value: unknown) => unknown) => run(tx),
  } as unknown as PrismaClient);
  await expect(
    service.submit(
      { id: source.resourceId, role: 'TEACHER' },
      source.resourceId,
      999,
    ),
  ).rejects.toMatchObject({ status: 404 });
  expect(latest).not.toHaveBeenCalled();
});
it('maps only recognized unique history collisions after the transaction rejects', async () => {
  const transaction = vi.fn();
  const service = new LessonWorkflowService({
    $transaction: transaction,
  } as unknown as PrismaClient);
  for (const target of [['revisionId'], ['lessonId', 'number'], ['email']]) {
    const error = new Prisma.PrismaClientKnownRequestError('private', {
      code: 'P2002',
      clientVersion: '7',
      meta: { target },
    });
    transaction.mockRejectedValueOnce(error);
    const action = service.submit(
      { id: source.resourceId, role: 'TEACHER' },
      source.resourceId,
      1,
    );
    if (target[0] === 'email') await expect(action).rejects.toBe(error);
    else await expect(action).rejects.toMatchObject({ status: 409 });
  }
});

const reviewStates = ['SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED'] as const;
type ReviewState = (typeof reviewStates)[number];
function reviewTargetFixture(state: ReviewState) {
  const lessonId = '22222222-2222-4222-8222-222222222222';
  const currentId = '33333333-3333-4333-8333-333333333333';
  const olderId = '44444444-4444-4444-8444-444444444444';
  const crossId = '55555555-5555-4555-8555-555555555555';
  const unknownId = '66666666-6666-4666-8666-666666666666';
  const events: string[] = [];
  const row = {
    id: lessonId,
    ownerId: source.resourceId,
    version: 7,
    currentRevisionId: currentId,
    draftContent:
      state === 'CHANGES_REQUESTED'
        ? { ...completeContent, sources: [source] }
        : null,
    draftGenerationOrigin: state === 'CHANGES_REQUESTED' ? 'MANUAL' : null,
    currentRevision: {
      id: currentId,
      number: 2,
      review:
        state === 'SUBMITTED'
          ? null
          : { decision: state === 'APPROVED' ? 'APPROVE' : 'REQUEST_CHANGES' },
    },
  };
  const revisions = new Map([
    [currentId, lessonId],
    [olderId, lessonId],
    [crossId, 'another-lesson'],
  ]);
  const tx = {
    $queryRaw: vi.fn(() => {
      events.push('lock');
      return [{ id: lessonId }];
    }),
    lesson: {
      findFirst: vi.fn((): typeof row | null => {
        events.push('lesson');
        return row;
      }),
      updateMany: vi.fn(),
    },
    lessonRevision: {
      findFirst: vi.fn((args: { where: { id?: string; lessonId: string } }) => {
        if (!args.where.id) {
          events.push('latest');
          return { id: currentId };
        }
        events.push('target');
        return revisions.get(args.where.id) === args.where.lessonId
          ? { id: args.where.id }
          : null;
      }),
      create: vi.fn(),
    },
    revisionSource: { createMany: vi.fn() },
    review: { create: vi.fn() },
  };
  const transaction = vi.fn((run: (value: unknown) => unknown) => run(tx));
  const service = new LessonWorkflowService({
    $transaction: transaction,
  } as unknown as PrismaClient);
  function noWrites() {
    for (const mutation of [
      tx.lesson.updateMany,
      tx.lessonRevision.create,
      tx.revisionSource.createMany,
      tx.review.create,
    ])
      expect(mutation).not.toHaveBeenCalled();
  }
  return {
    service,
    tx,
    row,
    transaction,
    events,
    lessonId,
    currentId,
    olderId,
    crossId,
    unknownId,
    noWrites,
  };
}
const invalidTargetCases = reviewStates.flatMap((state) =>
  (['fresh', 'stale'] as const).flatMap((version) =>
    (['unknown', 'cross'] as const).map((target) => ({
      state,
      version,
      target,
    })),
  ),
);
it.each(invalidTargetCases)(
  'rejects invalid review targets before conflicts: $state / $version / $target',
  async ({ state, version, target }) => {
    const f = reviewTargetFixture(state);
    const before = structuredClone(f.row);
    await expect(
      f.service.review(
        { id: source.resourceId, role: 'ADMIN' },
        f.lessonId,
        target === 'unknown' ? f.unknownId : f.crossId,
        { expectedVersion: version === 'fresh' ? 7 : 6, decision: 'APPROVE' },
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.events).toEqual(['lock', 'lesson', 'latest', 'target']);
    f.noWrites();
    expect(f.row).toEqual(before);
  },
);
it.each(reviewStates)(
  'retains same-lesson conflicts without writes in %s',
  async (state) => {
    const f = reviewTargetFixture(state);
    for (const target of [f.currentId, f.olderId]) {
      for (const expectedVersion of [7, 6]) {
        if (
          state === 'SUBMITTED' &&
          target === f.currentId &&
          expectedVersion === 7
        )
          continue;
        await expect(
          f.service.review(
            { id: source.resourceId, role: 'ADMIN' },
            f.lessonId,
            target,
            { expectedVersion, decision: 'APPROVE' },
          ),
        ).rejects.toMatchObject({ status: 409 });
      }
    }
    f.noWrites();
  },
);
it('denies teacher reviews before any lesson lock or target lookup', async () => {
  const f = reviewTargetFixture('APPROVED');
  await expect(
    f.service.review(
      { id: source.resourceId, role: 'TEACHER' },
      f.lessonId,
      f.unknownId,
      { expectedVersion: 6, decision: 'APPROVE' },
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(f.transaction).not.toHaveBeenCalled();
  expect(f.events).toEqual([]);
  f.noWrites();
});
it.each(['missing-lock-row', 'missing-authorized-lesson'] as const)(
  'checks lesson existence before review membership: %s',
  async (missing) => {
    const f = reviewTargetFixture('SUBMITTED');
    if (missing === 'missing-lock-row') f.tx.$queryRaw.mockReturnValueOnce([]);
    else f.tx.lesson.findFirst.mockReturnValueOnce(null);
    await expect(
      f.service.review(
        { id: source.resourceId, role: 'ADMIN' },
        f.lessonId,
        f.crossId,
        { expectedVersion: 6, decision: 'APPROVE' },
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.tx.lessonRevision.findFirst).not.toHaveBeenCalled();
    f.noWrites();
  },
);
