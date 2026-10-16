import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  resourceId,
  resourceInput,
  resourceQuery,
  retirementInput,
  resourceLimits,
} from './resources.input.js';
import {
  ResourcesService,
  resourceDetailSelect,
  resourceSummarySelect,
} from './resources.service.js';

const content = {
  title: 'Equal parts',
  subject: 'Mathematics' as const,
  grade: 'Grade 4' as const,
  sourceReference: 'Original demonstration',
  contentText: 'One half is one of two equal parts.',
};
const id = '11111111-1111-4111-8111-111111111111';
const row = {
  ...content,
  id,
  version: 1,
  retiredAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

it('requires exact content and context, trims edges, and treats citation as inert text', () => {
  expect(
    resourceInput({
      ...content,
      title: ' Equal parts ',
      sourceReference: 'https://private.invalid/material',
    }),
  ).toEqual({
    ...content,
    title: 'Equal parts',
    sourceReference: 'https://private.invalid/material',
  });
  for (const value of [
    null,
    [],
    {},
    { ...content, grade: '4' },
    { ...content, subject: 'Science' },
    ...[
      'id',
      'retiredAt',
      'version',
      'createdAt',
      'updatedAt',
      'expectedVersion',
      '__proto__',
    ].map((key) => ({ ...content, [key]: 1 })),
  ])
    expect(() => resourceInput(value)).toThrow(BadRequestException);
  for (const key of Object.keys(content)) {
    const missing = { ...content } as Record<string, unknown>;
    delete missing[key];
    expect(() => resourceInput(missing)).toThrow(BadRequestException);
    for (const value of ['', ' \n\t ', null, 1, ['text'], 'x\0y'])
      expect(() => resourceInput({ ...content, [key]: value })).toThrow(
        BadRequestException,
      );
  }
  for (const [key, limit] of Object.entries(resourceLimits)) {
    expect(
      resourceInput({ ...content, [key]: 'x'.repeat(limit) })[
        key as keyof typeof resourceLimits
      ],
    ).toHaveLength(limit);
    expect(() =>
      resourceInput({ ...content, [key]: 'x'.repeat(limit + 1) }),
    ).toThrow(BadRequestException);
  }
});
it('bounds version preconditions, ids, and list queries, rejecting duplicates and unknown parameters', () => {
  expect(resourceQuery({})).toEqual({ limit: 20 });
  expect(resourceQuery({ limit: '50', after: id.toUpperCase() })).toEqual({
    limit: 50,
    after: id,
  });
  for (const query of [
    { limit: '0' },
    { limit: '51' },
    { limit: '1.5' },
    { limit: ['1', '2'] },
    { after: [] },
    { after: 'invalid' },
    { includeRetired: 'true' },
  ])
    expect(() => resourceQuery(query)).toThrow(BadRequestException);
  for (const expectedVersion of [
    undefined,
    null,
    '1',
    0,
    -1,
    1.5,
    2147483648,
  ]) {
    expect(() => retirementInput({ expectedVersion })).toThrow(
      BadRequestException,
    );
    expect(() => resourceInput({ ...content, expectedVersion }, true)).toThrow(
      BadRequestException,
    );
  }
  expect(() =>
    retirementInput({ expectedVersion: 1, retiredAt: null }),
  ).toThrow(BadRequestException);
  expect(retirementInput({ expectedVersion: 2 })).toBe(2);
  expect(() => resourceInput(content, true)).toThrow(BadRequestException);
  expect(() => resourceId('../auth/me')).toThrow(BadRequestException);
});

function fixture() {
  const resource = {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn().mockResolvedValue(row),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({ ...row, version: 2 }),
  };
  const tx = {
    curriculumResource: resource,
    $queryRaw: vi.fn().mockResolvedValue([{ id }]),
  };
  const transaction = vi.fn(async (run: (client: typeof tx) => unknown) =>
    run(tx),
  );
  const service = new ResourcesService({
    curriculumResource: resource,
    $transaction: transaction,
  } as unknown as PrismaClient);
  return { service, resource, tx, transaction };
}
it('uses bounded keyset ordering and only summary fields, filtering teacher reads in the database', async () => {
  const { service, resource } = fixture();
  resource.findMany.mockResolvedValue([
    row,
    { ...row, id: '22222222-2222-4222-8222-222222222222' },
  ]);
  expect(await service.list('TEACHER', 1, id)).toEqual({
    items: [row],
    nextAfter: id,
  });
  expect(resource.findMany).toHaveBeenCalledWith({
    where: { retiredAt: null, id: { gt: id } },
    select: resourceSummarySelect,
    orderBy: { id: 'asc' },
    take: 2,
  });
  await service.list('ADMIN', 20);
  expect(resource.findMany).toHaveBeenLastCalledWith({
    where: {},
    select: resourceSummarySelect,
    orderBy: { id: 'asc' },
    take: 21,
  });
  resource.findFirst.mockResolvedValue(null);
  await expect(service.detail('TEACHER', id)).rejects.toThrow(
    NotFoundException,
  );
  expect(resource.findFirst).toHaveBeenCalledWith({
    where: { id, retiredAt: null },
    select: resourceDetailSelect,
  });
  resource.findFirst.mockResolvedValue({ ...row, retiredAt: new Date() });
  expect((await service.detail('ADMIN', id)).retiredAt).not.toBeNull();
});
it('allows only administrators to mutate and allowlists all persisted content fields', async () => {
  const { service, resource, transaction } = fixture();
  expect(() => service.create('TEACHER', content)).toThrow(ForbiddenException);
  await expect(service.mutate('TEACHER', id, 1)).rejects.toThrow(
    ForbiddenException,
  );
  expect(transaction).not.toHaveBeenCalled();
  await service.create('ADMIN', {
    ...content,
    id: 'untrusted',
    version: 900,
  } as typeof content);
  expect(resource.create).toHaveBeenCalledWith({
    data: content,
    select: resourceDetailSelect,
  });
  await service.mutate('ADMIN', id, 1, {
    ...content,
    retiredAt: new Date(),
    version: 900,
  } as typeof content);
  expect(resource.update).toHaveBeenCalledWith({
    where: { id },
    data: { ...content, version: { increment: 1 } },
    select: resourceDetailSelect,
  });
});
it('locks before checking versions/state, rejects stale or retired edits, and keeps repeated retirement unchanged', async () => {
  const { service, resource, tx } = fixture();
  await expect(service.mutate('ADMIN', id, 2, content)).rejects.toThrow(
    ConflictException,
  );
  expect(tx.$queryRaw).toHaveBeenCalled();
  expect(resource.update).not.toHaveBeenCalled();
  const retired = { ...row, retiredAt: new Date() };
  resource.findUniqueOrThrow.mockResolvedValue(retired);
  await expect(service.mutate('ADMIN', id, 1, content)).rejects.toThrow(
    ConflictException,
  );
  expect(await service.mutate('ADMIN', id, 1)).toEqual(retired);
  expect(resource.update).not.toHaveBeenCalled();
  tx.$queryRaw.mockResolvedValue([]);
  await expect(service.mutate('ADMIN', id, 1)).rejects.toThrow(
    NotFoundException,
  );
});
it('increments retirement once and propagates failures for transaction rollback/sanitization', async () => {
  const { service, resource } = fixture();
  await service.mutate('ADMIN', id, 1);
  expect(resource.update).toHaveBeenCalledWith({
    where: { id },
    data: { retiredAt: expect.any(Date), version: { increment: 1 } },
    select: resourceDetailSelect,
  });
  resource.update.mockRejectedValue(new Error('private driver failure'));
  await expect(service.mutate('ADMIN', id, 1, content)).rejects.toThrow(
    'private driver failure',
  );
});
