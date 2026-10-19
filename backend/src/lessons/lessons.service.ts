import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import type { UserRole } from '../generated/prisma/enums.js';
import { resourceDetailSelect } from '../resources/resources.service.js';
import { draftContent, type DraftContent } from './lessons.input.js';

type Actor = { id: string; role: UserRole };
const select = {
  id: true,
  ownerId: true,
  draftContent: true,
  draftGenerationOrigin: true,
  currentRevisionId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  currentRevision: { select: { review: { select: { decision: true } } } },
} as const;
type Row = Prisma.LessonGetPayload<{ select: typeof select }>;
type Source = {
  resourceId: string;
  resourceVersion: number;
  snapshot: {
    title: string;
    subject: string;
    grade: string;
    sourceReference: string;
    contentText: string;
  };
};
function editable(row: Row) {
  if (
    row.draftContent === null ||
    row.draftGenerationOrigin === null ||
    (row.currentRevisionId !== null &&
      row.currentRevision?.review?.decision !== 'REQUEST_CHANGES')
  )
    throw new ConflictException('Lesson state conflict.');
}
function stored(row: Row): { content: DraftContent; sources: Source[] } {
  const { sources = [], ...content } =
    row.draftContent as unknown as DraftContent & { sources?: Source[] };
  return { content, sources };
}
function summary(row: Row) {
  return {
    id: row.id,
    title: stored(row).content.title ?? '',
    version: row.version,
    state: row.currentRevisionId ? 'CHANGES_REQUESTED' : 'DRAFT',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
function detail(row: Row) {
  editable(row);
  return {
    ...summary(row),
    ...stored(row),
    generationOrigin: row.draftGenerationOrigin,
  };
}
export class LessonsService {
  constructor(private readonly db: PrismaClient) {}
  private teacher(actor: Actor) {
    if (actor.role !== 'TEACHER') throw new ForbiddenException('Forbidden.');
  }
  async list(actor: Actor, limit: number, after?: string) {
    this.teacher(actor);
    const rows = await this.db.lesson.findMany({
      where: {
        ownerId: actor.id,
        draftContent: { not: Prisma.DbNull },
        OR: [
          { currentRevisionId: null },
          { currentRevision: { review: { decision: 'REQUEST_CHANGES' } } },
        ],
        ...(after ? { id: { gt: after } } : {}),
      },
      select,
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    const items = rows.slice(0, limit).map((row) => {
      editable(row);
      return summary(row);
    });
    return { items, nextAfter: rows.length > limit ? items.at(-1)!.id : null };
  }
  async detail(actor: Actor, id: string) {
    this.teacher(actor);
    const row = await this.db.lesson.findFirst({
      where: { id, ownerId: actor.id },
      select,
    });
    if (!row) throw new NotFoundException('Not found.');
    return detail(row);
  }
  async create(actor: Actor, content: DraftContent) {
    this.teacher(actor);
    return detail(
      await this.db.lesson.create({
        data: {
          ownerId: actor.id,
          draftGenerationOrigin: 'MANUAL',
          draftContent: { ...draftContent(content), sources: [] },
        },
        select,
      }),
    );
  }
  async mutate(
    actor: Actor,
    id: string,
    version: number,
    change:
      | { content: DraftContent }
      | { action: 'select' | 'remove' | 'refresh'; resourceId: string },
  ) {
    this.teacher(actor);
    const content =
      'content' in change ? draftContent(change.content) : undefined;
    return this.db.$transaction(
      async (tx) => {
        // Every future lifecycle mutation must acquire this lesson lock first too.
        const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Lesson" WHERE id = ${id}::uuid AND "ownerId" = ${actor.id}::uuid FOR UPDATE
      `;
        if (!locked.length) throw new NotFoundException('Not found.');
        const row = await tx.lesson.findUniqueOrThrow({
          where: { id },
          select,
        });
        if (row.ownerId !== actor.id) throw new NotFoundException('Not found.');
        editable(row);
        if (row.version !== version || version === 2147483647)
          throw new ConflictException('Lesson version conflict.');
        const draft = stored(row);
        let sources = draft.sources;
        if ('action' in change) {
          const index = sources.findIndex(
            (s) => s.resourceId === change.resourceId,
          );
          if (
            (change.action === 'select' && index !== -1) ||
            (change.action !== 'select' && index === -1)
          )
            throw new ConflictException('Selection conflict.');
          if (change.action === 'remove')
            sources = sources.filter((s) => s.resourceId !== change.resourceId);
          else {
            if (change.action === 'select' && sources.length >= 5)
              throw new ConflictException('Selection limit.');
            // Conflicts with resource management's FOR UPDATE lock and ordinary UPDATEs.
            // Read only AFTER the lock to capture the latest committed active version.
            const resources = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM "CurriculumResource" WHERE id = ${change.resourceId}::uuid FOR SHARE
          `;
            if (!resources.length) throw new NotFoundException('Not found.');
            const resource = await tx.curriculumResource.findUniqueOrThrow({
              where: { id: change.resourceId },
              select: resourceDetailSelect,
            });
            if (resource.retiredAt)
              throw new ConflictException('Resource retired.');
            const selection: Source = {
              resourceId: resource.id,
              resourceVersion: resource.version,
              snapshot: {
                title: resource.title,
                subject: resource.subject,
                grade: resource.grade,
                sourceReference: resource.sourceReference,
                contentText: resource.contentText,
              },
            };
            sources =
              change.action === 'select'
                ? [...sources, selection]
                : sources.map((s, i) => (i === index ? selection : s));
          }
        }
        const result = await tx.lesson.updateMany({
          where: { id, ownerId: actor.id, version },
          data: {
            draftContent: {
              ...(content ?? draft.content),
              sources,
            } as Prisma.InputJsonObject,
            version: { increment: 1 },
          },
        });
        if (result.count !== 1) throw new ConflictException('Lesson conflict.');
        return detail(
          await tx.lesson.findUniqueOrThrow({ where: { id }, select }),
        );
      },
      { maxWait: 5000, timeout: 5000 },
    );
  }
}
