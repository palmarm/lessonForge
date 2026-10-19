import {
  lessonFixture,
  teacher,
  lessonId,
  resourceId,
} from '../../test/support/lesson-fixture.js';
import { draftContent, lessonInput } from './lessons.input.js';

it('accepts incomplete drafts without claiming submission completeness or normalizing entered text', () => {
  const value = {
    title: '  ',
    materials: [],
    activities: [{}],
    introduction: { durationMinutes: 0 },
    durationMinutes: 10,
  };
  expect(draftContent(value)).toEqual(value);
  expect(draftContent({})).toEqual({});
});
it.each([
  null,
  [],
  { sources: [] },
  { ownerId: teacher.id },
  { title: null },
  { title: 'a'.repeat(201) },
  { title: '\0' },
  { subject: 'English' },
  { grade: 'Grade 5' },
  { durationMinutes: -1 },
  { durationMinutes: 1.5 },
  { durationMinutes: 1441 },
  { introduction: { durationMinutes: '3' } },
  { assessment: { extra: '' } },
  { differentiation: { learnerSupport: false } },
  { activities: [null] },
  { activities: [{ text: 'bad' }] },
  { materials: [false] },
  { learningObjectives: Array(31).fill('x') },
  {
    activities: Array.from({ length: 30 }, () => ({
      teacherTasks: 'x'.repeat(4000),
    })),
  },
])(
  'rejects invalid draft structure, types, context, unknown fields, or limits: %j',
  (value) => {
    expect(() => draftContent(value)).toThrow();
  },
);
it('rejects client identities, sources, origins, snapshot/version metadata, and malformed expected versions', () => {
  for (const extra of [
    'ownerId',
    'id',
    'sources',
    'generationOrigin',
    'snapshot',
    'version',
  ])
    expect(() => lessonInput({ content: {}, [extra]: teacher.id })).toThrow();
  for (const expectedVersion of [null, 0, -1, 1.1, '1', 2147483648])
    expect(() => lessonInput({ content: {}, expectedVersion }, true)).toThrow();
});
it('sets creation ownership/origin server-side and creates no revision', async () => {
  const f = lessonFixture();
  const result = await f.service.create(teacher, {});
  expect(f.db.lesson.create.mock.calls[0]![0].data).toEqual({
    ownerId: teacher.id,
    draftGenerationOrigin: 'MANUAL',
    draftContent: { sources: [] },
  });
  expect(result.version).toBe(1);
  expect(result.sources).toEqual([]);
});
it('enforces teacher role on every service entry point and ownership before version checks', async () => {
  const f = lessonFixture();
  const admin = { ...teacher, role: 'ADMIN' as const };
  for (const promise of [
    f.service.create(admin, {}),
    f.service.list(admin, 20),
    f.service.detail(admin, lessonId),
    f.service.mutate(admin, lessonId, 1, { content: {} }),
  ])
    await expect(promise).rejects.toMatchObject({ status: 403 });
  const foreign = { ...teacher, id: resourceId };
  await expect(f.service.detail(foreign, lessonId)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    f.service.mutate(foreign, lessonId, 999, { content: {} }),
  ).rejects.toMatchObject({ status: 404 });
  expect(f.tx.lesson.updateMany).not.toHaveBeenCalled();
});
it('preserves captured snapshots across content saves and refreshes only on explicit request', async () => {
  const f = lessonFixture();
  const selected = await f.service.mutate(teacher, lessonId, 1, {
    action: 'select',
    resourceId,
  });
  expect(selected.sources[0]).toEqual({
    resourceId,
    resourceVersion: 1,
    snapshot: {
      title: 'Fractions',
      subject: 'Mathematics',
      grade: 'Grade 4',
      sourceReference: 'Original demonstration',
      contentText: '<script>one half</script>',
    },
  });
  f.resource.version = 2;
  f.resource.contentText = 'New text';
  const saved = await f.service.mutate(teacher, lessonId, 2, { content: {} });
  expect(saved.sources).toEqual(selected.sources);
  expect(f.tx.curriculumResource.findUniqueOrThrow).toHaveBeenCalledTimes(1);
  const refreshed = await f.service.mutate(teacher, lessonId, 3, {
    action: 'refresh',
    resourceId,
  });
  expect(refreshed.sources[0]!.resourceVersion).toBe(2);
  expect(refreshed.sources[0]!.snapshot.contentText).toBe('New text');
  f.resource.retiredAt = new Date();
  await expect(
    f.service.mutate(teacher, lessonId, 4, { action: 'refresh', resourceId }),
  ).rejects.toMatchObject({ status: 409 });
  expect((await f.service.detail(teacher, lessonId)).sources).toEqual(
    refreshed.sources,
  );
  expect(
    (
      await f.service.mutate(teacher, lessonId, 4, {
        action: 'remove',
        resourceId,
      })
    ).sources,
  ).toEqual([]);
});
it('checks lifecycle inside the locked transaction, rejects stale source actions, and handles changes-requested drafts', async () => {
  const f = lessonFixture();
  for (const action of ['select', 'remove', 'refresh'] as const)
    await expect(
      f.service.mutate(teacher, lessonId, 2, { action, resourceId }),
    ).rejects.toMatchObject({ status: 409 });
  expect(f.tx.curriculumResource.findUniqueOrThrow).not.toHaveBeenCalled();
  f.set({ currentRevisionId: resourceId, currentRevision: { review: null } });
  await expect(
    f.service.mutate(teacher, lessonId, 1, { content: {} }),
  ).rejects.toMatchObject({ status: 409 });
  f.set({ currentRevision: { review: { decision: 'APPROVE' } } });
  await expect(
    f.service.mutate(teacher, lessonId, 1, { content: {} }),
  ).rejects.toMatchObject({ status: 409 });
  f.set({ currentRevision: { review: { decision: 'REQUEST_CHANGES' } } });
  expect(
    (await f.service.mutate(teacher, lessonId, 1, { content: {} })).state,
  ).toBe('CHANGES_REQUESTED');
});
it('uses a conditional atomic write and never treats a failed compare-and-swap as success', async () => {
  const f = lessonFixture();
  f.tx.lesson.updateMany.mockResolvedValueOnce({ count: 0 });
  await expect(
    f.service.mutate(teacher, lessonId, 1, { content: {} }),
  ).rejects.toMatchObject({ status: 409 });
  expect(f.tx.lesson.updateMany.mock.calls[0]![0].where).toEqual({
    id: lessonId,
    ownerId: teacher.id,
    version: 1,
  });
});

it('rejects duplicate/missing selections and caps selection count without mutating the lesson', async () => {
  const f = lessonFixture();
  for (const action of ['remove', 'refresh'] as const)
    await expect(
      f.service.mutate(teacher, lessonId, 1, { action, resourceId }),
    ).rejects.toMatchObject({ status: 409 });
  await f.service.mutate(teacher, lessonId, 1, {
    action: 'select',
    resourceId,
  });
  await expect(
    f.service.mutate(teacher, lessonId, 2, { action: 'select', resourceId }),
  ).rejects.toMatchObject({ status: 409 });
  const before = f.tx.lesson.updateMany.mock.calls.length;
  f.set({
    draftContent: {
      sources: Array.from({ length: 5 }, (_, i) => ({
        resourceId: `stored-${i}`,
      })),
    },
  });
  await expect(
    f.service.mutate(teacher, lessonId, 2, { action: 'select', resourceId }),
  ).rejects.toMatchObject({ status: 409 });
  expect(f.tx.lesson.updateMany.mock.calls).toHaveLength(before);
});
it('rejects unavailable resources and exhausted versions with no content/source write', async () => {
  const f = lessonFixture();
  f.tx.$queryRaw
    .mockResolvedValueOnce([{ id: lessonId }])
    .mockResolvedValueOnce([]);
  await expect(
    f.service.mutate(teacher, lessonId, 1, { action: 'select', resourceId }),
  ).rejects.toMatchObject({ status: 404 });
  f.set({ version: 2147483647 });
  await expect(
    f.service.mutate(teacher, lessonId, 2147483647, { content: {} }),
  ).rejects.toMatchObject({ status: 409 });
  expect(f.tx.lesson.updateMany).not.toHaveBeenCalled();
});
