import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { LessonsService } from '../../src/lessons/lessons.service.js';
export const teacher = {
  id: '11111111-1111-4111-8111-111111111111',
  role: 'TEACHER' as const,
};
export const lessonId = '22222222-2222-4222-8222-222222222222';
export const resourceId = '33333333-3333-4333-8333-333333333333';
export const stamp = new Date('2030-01-01T00:00:00Z');
export function lessonFixture() {
  let row = {
    id: lessonId,
    ownerId: teacher.id,
    draftContent: { title: 'Saved', sources: [] as object[] } as object | null,
    draftGenerationOrigin: 'MANUAL' as string | null,
    currentRevisionId: null as string | null,
    currentRevision: null as { review: { decision: string } | null } | null,
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
  };
  const resource = {
    id: resourceId,
    title: 'Fractions',
    subject: 'Mathematics',
    grade: 'Grade 4',
    sourceReference: 'Original demonstration',
    contentText: '<script>one half</script>',
    version: 1,
    retiredAt: null as Date | null,
    createdAt: stamp,
    updatedAt: stamp,
  };
  const lesson = {
    findFirst: vi.fn((args: { where: { id: string; ownerId: string } }) =>
      Promise.resolve(
        args.where.id === row.id && args.where.ownerId === row.ownerId
          ? row
          : null,
      ),
    ),
    findMany: vi.fn(() => Promise.resolve([row])),
    findUniqueOrThrow: vi.fn(() => Promise.resolve(row)),
    create: vi.fn((args: { data: object }) => {
      row = { ...row, ...args.data };
      return Promise.resolve(row);
    }),
    updateMany: vi.fn(
      (args: {
        data: { draftContent: object };
        where: { version: number };
      }) => {
        if (args.where.version !== row.version)
          return Promise.resolve({ count: 0 });
        row = {
          ...row,
          draftContent: args.data.draftContent,
          version: row.version + 1,
        };
        return Promise.resolve({ count: 1 });
      },
    ),
  };
  const tx = {
    lesson,
    curriculumResource: {
      findUniqueOrThrow: vi.fn(() => Promise.resolve(resource)),
    },
    $queryRaw: vi.fn((sql: TemplateStringsArray, id: string, owner?: string) =>
      Promise.resolve(
        sql.join('').includes('"Lesson"')
          ? id === row.id && owner === row.ownerId
            ? [{ id }]
            : []
          : [{ id }],
      ),
    ),
  };
  const db = {
    lesson,
    $transaction: vi.fn((run: (tx: object) => unknown) => run(tx)),
  };
  return {
    service: new LessonsService(db as unknown as PrismaClient),
    db,
    tx,
    resource,
    row: () => row,
    set: (patch: Partial<typeof row>) => {
      row = { ...row, ...patch };
    },
  };
}
