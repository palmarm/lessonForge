import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ConflictException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { createDatabaseClient } from '../src/prisma/prisma.service.js';
import { ResourcesService } from '../src/resources/resources.service.js';
import { resourceInput } from '../src/resources/resources.input.js';
import { resolveConstraintDatabaseUrl } from './support/constraint-database.js';
import { initializeConstraintDatabase } from './support/constraint-preflight.js';

let db: PrismaClient | undefined;
let independent: PrismaClient | undefined;
let service: ResourcesService;
let competitor: ResourcesService;
let historyBefore: unknown;
let historyResourceId: string;
const content = resourceInput({
  title: 'Fraction demonstration',
  subject: 'Mathematics',
  grade: 'Grade 4',
  sourceReference: 'Original demonstration, no official curriculum alignment',
  contentText: 'One half is one of two equal parts.',
});
const client = () => {
  if (!db) throw new Error('Disposable resource setup incomplete.');
  return db;
};
async function history() {
  const database = client();
  return {
    users: await database.user.findMany({ orderBy: { id: 'asc' } }),
    lessons: await database.lesson.findMany({ orderBy: { id: 'asc' } }),
    revisions: await database.lessonRevision.findMany({
      orderBy: { id: 'asc' },
    }),
    sources: await database.revisionSource.findMany({
      orderBy: [{ revisionId: 'asc' }, { resourceId: 'asc' }],
    }),
    reviews: await database.review.findMany({ orderBy: { id: 'asc' } }),
  };
}
beforeAll(async () => {
  // Same dedicated URL/identity/empty-schema guards as the existing live suites.
  // No .env loader, DATABASE_URL fallback, reset, drop, or truncate.
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
      throw new Error('Resource disposable migration deployment failed.');
    }
  });
  independent = createDatabaseClient(url);
  service = new ResourcesService(db);
  competitor = new ResourcesService(independent);
  const teacher = await db.user.create({
    data: {
      email: 'resource-teacher@example.test',
      displayName: 'Teacher fixture',
      passwordHash: 'test-only-no-login',
      role: 'TEACHER',
    },
  });
  const admin = await db.user.create({
    data: {
      email: 'resource-admin@example.test',
      displayName: 'Admin fixture',
      passwordHash: 'test-only-no-login',
      role: 'ADMIN',
    },
  });
  const resource = await service.create('ADMIN', content);
  historyResourceId = resource.id;
  const lesson = await db.lesson.create({ data: { ownerId: teacher.id } });
  const revision = await db.lessonRevision.create({
    data: {
      lessonId: lesson.id,
      number: 1,
      content: { title: 'Submitted original', source: content.contentText },
      generationOrigin: 'MANUAL',
    },
  });
  await db.revisionSource.create({
    data: {
      revisionId: revision.id,
      resourceId: resource.id,
      resourceVersion: resource.version,
      snapshot: { ...content },
    },
  });
  await db.lesson.update({
    where: { id: lesson.id },
    data: { currentRevisionId: revision.id },
  });
  await db.review.create({
    data: {
      revisionId: revision.id,
      reviewerId: admin.id,
      decision: 'APPROVE',
    },
  });
  await db.lesson.create({
    data: {
      ownerId: teacher.id,
      draftContent: {
        title: 'Editable copy',
        sources: [
          { resourceId: resource.id, resourceVersion: 1, snapshot: content },
        ],
      },
      draftGenerationOrigin: 'MANUAL',
      copiedFromRevisionId: revision.id,
    },
  });
  historyBefore = await history();
});
afterAll(async () => {
  await Promise.all([db?.$disconnect(), independent?.$disconnect()]);
});
it('persists creates/edits and active/retired visibility across independent clients', async () => {
  const created = await service.create('ADMIN', content);
  expect(created.version).toBe(1);
  expect(created.retiredAt).toBeNull();
  expect(await competitor.detail('TEACHER', created.id)).toEqual(created);
  const edited = await service.mutate('ADMIN', created.id, 1, {
    ...content,
    title: 'Updated equal parts',
  });
  expect(edited.version).toBe(2);
  expect(edited.createdAt).toEqual(created.createdAt);
  expect(await competitor.detail('ADMIN', created.id)).toEqual(edited);
  const retired = await competitor.mutate('ADMIN', created.id, 2);
  expect(retired.version).toBe(3);
  expect(retired.retiredAt).not.toBeNull();
  await expect(service.detail('TEACHER', created.id)).rejects.toMatchObject({
    status: 404,
  });
  expect(await service.detail('ADMIN', created.id)).toEqual(retired);
  expect(
    (await service.list('TEACHER', 50)).items.some((v) => v.id === created.id),
  ).toBe(false);
  expect(
    (await service.list('ADMIN', 50)).items.some((v) => v.id === created.id),
  ).toBe(true);
  expect(await service.mutate('ADMIN', created.id, 3)).toEqual(retired);
  await expect(service.mutate('ADMIN', created.id, 2)).rejects.toBeInstanceOf(
    ConflictException,
  );
  await expect(
    service.mutate('ADMIN', created.id, 3, content),
  ).rejects.toBeInstanceOf(ConflictException);
});
it('has exactly one winner for competing edits with the same expected version', async () => {
  const resource = await service.create('ADMIN', content);
  const results = await Promise.allSettled([
    service.mutate('ADMIN', resource.id, 1, {
      ...content,
      title: 'First contender',
    }),
    competitor.mutate('ADMIN', resource.id, 1, {
      ...content,
      title: 'Second contender',
    }),
  ]);
  const winners = results.filter((v) => v.status === 'fulfilled');
  const losers = results.filter((v) => v.status === 'rejected');
  expect(winners).toHaveLength(1);
  expect(losers).toHaveLength(1);
  expect(losers[0]!.reason).toBeInstanceOf(ConflictException);
  const saved = await service.detail('ADMIN', resource.id);
  expect(saved.version).toBe(2);
  expect(saved).toEqual(winners[0]!.value);
});
it('serializes edit/retirement and two competing retirements without overwriting a winner', async () => {
  const resource = await service.create('ADMIN', content);
  const outcomes = await Promise.allSettled([
    service.mutate('ADMIN', resource.id, 1, {
      ...content,
      title: 'Edit contender',
    }),
    competitor.mutate('ADMIN', resource.id, 1),
  ]);
  expect(outcomes.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
  const rejected = outcomes.find((v) => v.status === 'rejected');
  expect(rejected!.reason).toBeInstanceOf(ConflictException);
  const current = await competitor.detail('ADMIN', resource.id);
  expect(current.version).toBe(2);
  if (current.retiredAt) expect(current.title).toBe(content.title);
  else expect(current.title).toBe('Edit contender');
  const another = await service.create('ADMIN', content);
  const retirements = await Promise.allSettled([
    service.mutate('ADMIN', another.id, 1),
    competitor.mutate('ADMIN', another.id, 1),
  ]);
  expect(retirements.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
  expect((await service.detail('ADMIN', another.id)).version).toBe(2);
});
it('does not modify submitted snapshots, approved reviews, lesson drafts, or copy provenance', async () => {
  const current = await service.detail('ADMIN', historyResourceId);
  const editable = current.retiredAt
    ? current
    : await service.mutate('ADMIN', current.id, current.version, {
        ...content,
        contentText: 'Different current source text',
      });
  if (!editable.retiredAt)
    await service.mutate('ADMIN', editable.id, editable.version);
  expect(await history()).toEqual(historyBefore);
});

it('uses bounded deterministic keyset pages, including when a cursor record is retired', async () => {
  const first = await service.list('ADMIN', 2);
  expect(first.items).toHaveLength(2);
  expect(first.nextAfter).toBe(first.items[1]!.id);
  expect(first.items[0]!.id < first.items[1]!.id).toBe(true);
  const second = await service.list('ADMIN', 2, first.nextAfter!);
  expect(second.items.every((v) => v.id > first.nextAfter!)).toBe(true);
  const cursor = first.items[1]!;
  if (!cursor.retiredAt)
    await service.mutate('ADMIN', cursor.id, cursor.version);
  const teacherPage = await service.list('TEACHER', 2, cursor.id);
  expect(
    teacherPage.items.every((v) => v.id > cursor.id && v.retiredAt === null),
  ).toBe(true);
  expect(first.items.every((v) => !Object.hasOwn(v, 'contentText'))).toBe(true);
});
it('rolls back resource writes if the transaction fails after updating, preserving content/version/timestamps', async () => {
  const resource = await service.create('ADMIN', content);
  // Inject failure after the actual service write, inside its real PostgreSQL transaction.
  const failing = new ResourcesService({
    $transaction: (
      run: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: object,
    ) =>
      client().$transaction(async (tx) => {
        await run(tx);
        throw new Error('Injected rollback fixture');
      }, options),
  } as unknown as PrismaClient);
  await expect(
    failing.mutate('ADMIN', resource.id, 1, {
      ...content,
      title: 'Must roll back',
    }),
  ).rejects.toThrow('Injected rollback fixture');
  expect(await competitor.detail('ADMIN', resource.id)).toEqual(resource);
  await expect(failing.mutate('ADMIN', resource.id, 1)).rejects.toThrow(
    'Injected rollback fixture',
  );
  expect(await competitor.detail('ADMIN', resource.id)).toEqual(resource);
  await expect(
    service.mutate('ADMIN', resource.id, 2, content),
  ).rejects.toBeInstanceOf(ConflictException);
  expect(await competitor.detail('ADMIN', resource.id)).toEqual(resource);
});
