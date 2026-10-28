import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import type { UserRole } from '../generated/prisma/enums.js';
import { expectedVersion } from '../resources/resources.input.js';
import {
  submissionContent,
  trustedSources,
  reviewInput,
} from './lesson-workflow.input.js';

type Actor = { id: string; role: UserRole };
const bounds = { maxWait: 5000, timeout: 5000 };
const reviewSelect = {
  id: true,
  reviewerId: true,
  decision: true,
  feedback: true,
  decidedAt: true,
} as const;
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
  review: { select: reviewSelect },
} as const;
const lessonSelect = {
  id: true,
  ownerId: true,
  version: true,
  currentRevisionId: true,
  draftContent: true,
  draftGenerationOrigin: true,
  currentRevision: { select: revisionSelect },
} as const;
type Lesson = Prisma.LessonGetPayload<{ select: typeof lessonSelect }>;
type Revision = Prisma.LessonRevisionGetPayload<{
  select: typeof revisionSelect;
}>;
const conflict = () =>
  new ConflictException('Lesson state or version conflict.');
const invariant = () =>
  new ServiceUnavailableException('Lesson invariant failed.');

function state(row: Lesson) {
  const draft = row.draftContent !== null;
  if (draft !== (row.draftGenerationOrigin !== null)) throw invariant();
  if (!row.currentRevisionId) {
    if (!draft || row.currentRevision) throw invariant();
    return 'DRAFT' as const;
  }
  if (!row.currentRevision || row.currentRevision.id !== row.currentRevisionId)
    throw invariant();
  const decision = row.currentRevision.review?.decision;
  if (!decision && !draft) return 'SUBMITTED' as const;
  if (decision === 'REQUEST_CHANGES' && draft)
    return 'CHANGES_REQUESTED' as const;
  if (decision === 'APPROVE' && !draft) return 'APPROVED' as const;
  throw invariant();
}
function workflow(row: Lesson) {
  return {
    lessonId: row.id,
    version: row.version,
    state: state(row),
    currentRevisionId: row.currentRevisionId,
  };
}
function summary(revision: Revision) {
  return {
    id: revision.id,
    number: revision.number,
    title: (revision.content as { title: string }).title,
    generationOrigin: revision.generationOrigin,
    submittedAt: revision.submittedAt,
    review: revision.review,
  };
}
function role(actor: Actor, required?: UserRole) {
  if (
    (actor.role !== 'TEACHER' && actor.role !== 'ADMIN') ||
    (required && actor.role !== required)
  )
    throw new ForbiddenException('Forbidden.');
}

export class LessonWorkflowService {
  constructor(private readonly db: PrismaClient) {}

  private async load(tx: Prisma.TransactionClient, actor: Actor, id: string) {
    const row = await tx.lesson.findFirst({
      where: { id, ...(actor.role === 'TEACHER' ? { ownerId: actor.id } : {}) },
      select: lessonSelect,
    });
    // Authorization happens before invariant/version/state disclosure.
    if (!row || (actor.role === 'ADMIN' && !row.currentRevisionId))
      throw new NotFoundException('Not found.');
    const latest = await tx.lessonRevision.findFirst({
      where: { lessonId: id },
      orderBy: { number: 'desc' },
      select: { id: true },
    });
    if ((latest?.id ?? null) !== row.currentRevisionId) throw invariant();
    state(row);
    return row;
  }

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

  async history(actor: Actor, id: string, limit: number, after?: string) {
    role(actor);
    return this.read(async (tx) => {
      const row = await this.load(tx, actor, id);
      const revisions = await tx.lessonRevision.findMany({
        where: { lessonId: id, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: 'asc' },
        take: limit + 1,
        select: revisionSelect,
      });
      const items = revisions.slice(0, limit).map(summary);
      return {
        workflow: workflow(row),
        items,
        nextAfter: revisions.length > limit ? items.at(-1)!.id : null,
      };
    });
  }

  async detail(actor: Actor, id: string, revisionId: string) {
    role(actor);
    return this.read(async (tx) => {
      const row = await this.load(tx, actor, id);
      const revision = await tx.lessonRevision.findFirst({
        where: { id: revisionId, lessonId: id },
        select: revisionSelect,
      });
      if (!revision) throw new NotFoundException('Not found.');
      return { workflow: workflow(row), revision };
    });
  }

  async pending(actor: Actor, limit: number, after?: string) {
    role(actor, 'ADMIN');
    return this.read(async (tx) => {
      const rows = await tx.lesson.findMany({
        where: {
          currentRevision: { review: { is: null } },
          ...(after ? { id: { gt: after } } : {}),
        },
        orderBy: { id: 'asc' },
        take: limit + 1,
        select: lessonSelect,
      });
      const items = [];
      for (const candidate of rows.slice(0, limit)) {
        const row = await this.load(tx, actor, candidate.id);
        if (state(row) !== 'SUBMITTED') throw invariant();
        items.push({
          workflow: workflow(row),
          revision: summary(row.currentRevision!),
        });
      }
      return {
        items,
        nextAfter: rows.length > limit ? items.at(-1)!.workflow.lessonId : null,
      };
    });
  }

  private async mutate<T>(
    actor: Actor,
    id: string,
    version: number,
    run: (tx: Prisma.TransactionClient, row: Lesson) => Promise<T>,
    revisionId?: string,
  ) {
    expectedVersion(version);
    try {
      return await this.db.$transaction(
        async (tx) => {
          const locked =
            actor.role === 'TEACHER'
              ? await tx.$queryRaw<
                  { id: string }[]
                >`SELECT id FROM "Lesson" WHERE id = ${id}::uuid AND "ownerId" = ${actor.id}::uuid FOR UPDATE`
              : await tx.$queryRaw<
                  { id: string }[]
                >`SELECT id FROM "Lesson" WHERE id = ${id}::uuid FOR UPDATE`;
          if (!locked.length) throw new NotFoundException('Not found.');
          const row = await this.load(tx, actor, id);
          // Check the authorized lesson's target before lifecycle/version conflicts.
          if (revisionId !== undefined) {
            const target = await tx.lessonRevision.findFirst({
              where: { id: revisionId, lessonId: id },
              select: { id: true },
            });
            if (!target) throw new NotFoundException('Not found.');
          }
          const current = state(row);
          if (
            actor.role === 'TEACHER'
              ? !['DRAFT', 'CHANGES_REQUESTED'].includes(current)
              : current !== 'SUBMITTED'
          )
            throw conflict();
          if (row.version !== version || version === 2147483647)
            throw conflict();
          return run(tx, row);
        },
        {
          ...bounds,
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = error.meta?.target;
        if (
          Array.isArray(target) &&
          ((target.length === 1 && target[0] === 'revisionId') ||
            (target.length === 2 &&
              target.includes('lessonId') &&
              target.includes('number')))
        )
          throw conflict();
      }
      throw error;
    }
  }

  private async update(
    tx: Prisma.TransactionClient,
    row: Lesson,
    data: Prisma.LessonUncheckedUpdateManyInput,
  ) {
    const result = await tx.lesson.updateMany({
      where: { id: row.id, ownerId: row.ownerId, version: row.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count !== 1) throw conflict();
  }

  async submit(actor: Actor, id: string, version: number) {
    role(actor, 'TEACHER');
    return this.mutate(actor, id, version, async (tx, row) => {
      const { sources, ...fields } = row.draftContent as Prisma.JsonObject;
      const content = submissionContent(fields);
      const selections = trustedSources(sources ?? []);
      if (!selections.length)
        throw new BadRequestException('Sources required.');
      const number = (row.currentRevision?.number ?? 0) + 1;
      if (number > 2147483647) throw conflict();
      const created = await tx.lessonRevision.create({
        data: {
          lessonId: id,
          number,
          content: content as Prisma.InputJsonObject,
          generationOrigin: row.draftGenerationOrigin!,
        },
      });
      await tx.revisionSource.createMany({
        data: selections.map((source) => ({
          ...source,
          revisionId: created.id,
        })),
      });
      await this.update(tx, row, {
        currentRevisionId: created.id,
        draftContent: Prisma.DbNull,
        draftGenerationOrigin: null,
      });
      const committed = await this.load(tx, actor, id);
      return {
        workflow: workflow(committed),
        revision: committed.currentRevision!,
      };
    });
  }

  async review(actor: Actor, id: string, revisionId: string, body: unknown) {
    role(actor, 'ADMIN');
    const input = reviewInput(body);
    return this.mutate(
      actor,
      id,
      input.expectedVersion,
      async (tx, row) => {
        if (row.currentRevisionId !== revisionId) throw conflict();
        const revision = row.currentRevision!;
        await tx.review.create({
          data: {
            revisionId,
            reviewerId: actor.id,
            decision: input.decision,
            feedback: input.feedback,
          },
        });
        if (input.decision === 'REQUEST_CHANGES') {
          const sources = trustedSources(revision.sources);
          if (!sources.length) throw invariant();
          // Content is copied exactly; never reconstruct from current resources.
          await this.update(tx, row, {
            draftContent: {
              ...(revision.content as Prisma.JsonObject),
              sources,
            } as Prisma.InputJsonObject,
            draftGenerationOrigin: revision.generationOrigin,
          });
        } else await this.update(tx, row, {});
        const committed = await this.load(tx, actor, id);
        return {
          workflow: workflow(committed),
          revision: committed.currentRevision!,
        };
      },
      revisionId,
    );
  }
}
