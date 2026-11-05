import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import type { UserRole } from '../generated/prisma/enums.js';
import { resourceId } from '../resources/resources.input.js';
import { submissionContent, trustedSources } from './lesson-workflow.input.js';
import { copyInput, copyOperationKey } from './library.input.js';

type Actor = { id: string; role: UserRole };
const bounds = { maxWait: 5000, timeout: 5000 };
const invariant = () =>
  new ServiceUnavailableException('Library invariant failed.');
const revisionSelect = {
  id: true,
  number: true,
  content: true,
  generationOrigin: true,
  submittedAt: true,
  sources: {
    select: { resourceId: true, resourceVersion: true, snapshot: true },
    orderBy: { resourceId: 'asc' },
  },
  review: { select: { decision: true, decidedAt: true } },
} as const;
const approvedSelect = {
  id: true,
  version: true,
  currentRevisionId: true,
  draftContent: true,
  draftGenerationOrigin: true,
  currentRevision: { select: revisionSelect },
} as const;
const operationSelect = {
  id: true,
  copyOperationKey: true,
  copySourceVersion: true,
  copiedFromRevisionId: true,
  copiedFromRevision: { select: { lessonId: true } },
} as const;
type Approved = Prisma.LessonGetPayload<{ select: typeof approvedSelect }>;
type Operation = Prisma.LessonGetPayload<{ select: typeof operationSelect }>;

function role(actor: Actor, teacherOnly = false) {
  if (
    (actor.role !== 'TEACHER' && actor.role !== 'ADMIN') ||
    (teacherOnly && actor.role !== 'TEACHER')
  )
    throw new ForbiddenException('Forbidden.');
}

function operation(row: Operation) {
  if (
    !row.copyOperationKey ||
    !row.copySourceVersion ||
    !row.copiedFromRevisionId ||
    !row.copiedFromRevision
  )
    throw invariant();
  return {
    operation: {
      key: row.copyOperationKey,
      source: {
        lessonId: row.copiedFromRevision.lessonId,
        revisionId: row.copiedFromRevisionId,
        expectedVersion: row.copySourceVersion,
      },
      destinationLessonId: row.id,
    },
  };
}

export class LibraryService {
  constructor(private readonly db: PrismaClient) {}

  private read<T>(run: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return run(tx);
      },
      {
        ...bounds,
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );
  }

  private async approved(tx: Prisma.TransactionClient, row: Approved) {
    const revision = row.currentRevision;
    if (
      !revision ||
      revision.review?.decision !== 'APPROVE' ||
      row.currentRevisionId !== revision.id ||
      row.draftContent !== null ||
      row.draftGenerationOrigin !== null
    )
      throw invariant();
    const latest = await tx.lessonRevision.findFirst({
      where: { lessonId: row.id },
      orderBy: { number: 'desc' },
      select: { id: true },
    });
    if (latest?.id !== revision.id) throw invariant();
    try {
      submissionContent(revision.content);
    } catch {
      throw invariant();
    }
    if (!trustedSources(revision.sources).length) throw invariant();
    return {
      workflow: {
        lessonId: row.id,
        version: row.version,
        state: 'APPROVED' as const,
        currentRevisionId: revision.id,
      },
      revision: {
        id: revision.id,
        number: revision.number,
        content: revision.content,
        generationOrigin: revision.generationOrigin,
        submittedAt: revision.submittedAt,
        sources: revision.sources,
      },
      approvedAt: revision.review.decidedAt,
    };
  }

  private async source(
    tx: Prisma.TransactionClient,
    lessonId: string,
    revisionId: string,
  ) {
    const row = await tx.lesson.findFirst({
      where: {
        id: lessonId,
        currentRevisionId: revisionId,
        currentRevision: { review: { decision: 'APPROVE' } },
      },
      select: approvedSelect,
    });
    // Library access authorizes only an exact currently approved target.
    if (!row) throw new NotFoundException('Not found.');
    return this.approved(tx, row);
  }

  async list(actor: Actor, limit: number, after?: string) {
    role(actor);
    return this.read(async (tx) => {
      const rows = await tx.lesson.findMany({
        where: {
          currentRevision: { review: { decision: 'APPROVE' } },
          ...(after ? { id: { gt: after } } : {}),
        },
        orderBy: { id: 'asc' },
        take: limit + 1,
        select: approvedSelect,
      });
      const items = [];
      for (const row of rows.slice(0, limit)) {
        const item = await this.approved(tx, row);
        const revision = item.revision;
        items.push({
          ...item,
          revision: {
            id: revision.id,
            number: revision.number,
            title: (revision.content as { title: string }).title,
            generationOrigin: revision.generationOrigin,
            submittedAt: revision.submittedAt,
          },
        });
      }
      return {
        items,
        nextAfter: rows.length > limit ? items.at(-1)!.workflow.lessonId : null,
      };
    });
  }

  async detail(actor: Actor, lessonId: string, revisionId: string) {
    role(actor);
    return this.read((tx) =>
      this.source(tx, resourceId(lessonId), resourceId(revisionId)),
    );
  }

  async recover(actor: Actor, key: string) {
    role(actor, true);
    key = copyOperationKey(key);
    return this.read(async (tx) => {
      const row = await tx.lesson.findUnique({
        where: {
          ownerId_copyOperationKey: {
            ownerId: actor.id,
            copyOperationKey: key,
          },
        },
        select: operationSelect,
      });
      if (!row) throw new NotFoundException('Not found.');
      return operation(row);
    });
  }

  async copy(
    actor: Actor,
    lessonId: string,
    revisionId: string,
    body: unknown,
  ) {
    role(actor, true);
    lessonId = resourceId(lessonId);
    revisionId = resourceId(revisionId);
    const input = copyInput(body);
    return this.db.$transaction(
      async (tx) => {
        // Serialize this teacher/key even when competing requests name different sources.
        // Hash collisions only serialize unrelated operations; uniqueness remains in SQL.
        const lock = `${actor.id}:${input.operationKey}`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))::text`;
        const existing = await tx.lesson.findUnique({
          where: {
            ownerId_copyOperationKey: {
              ownerId: actor.id,
              copyOperationKey: input.operationKey,
            },
          },
          select: operationSelect,
        });
        if (existing) {
          const recovered = operation(existing);
          const source = recovered.operation.source;
          if (
            source.lessonId !== lessonId ||
            source.revisionId !== revisionId ||
            source.expectedVersion !== input.expectedVersion
          )
            throw new ConflictException('Copy operation conflict.');
          // No source-version/state recheck: this operation already succeeded.
          // No creation snapshot or mutable destination content is replayed.
          return { created: false, result: recovered };
        }
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM "Lesson" WHERE id = ${lessonId}::uuid FOR UPDATE`;
        if (!locked.length) throw new NotFoundException('Not found.');
        const source = await this.source(tx, lessonId, revisionId);
        if (source.workflow.version !== input.expectedVersion)
          throw new ConflictException('Source version conflict.');
        const row = await tx.lesson.create({
          data: {
            ownerId: actor.id,
            copiedFromRevisionId: revisionId,
            copyOperationKey: input.operationKey,
            copySourceVersion: input.expectedVersion,
            draftGenerationOrigin: source.revision.generationOrigin,
            draftContent: {
              ...(source.revision.content as Prisma.JsonObject),
              sources: source.revision.sources,
            } as Prisma.InputJsonObject,
          },
          select: operationSelect,
        });
        return { created: true, result: operation(row) };
      },
      {
        ...bounds,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }
}
