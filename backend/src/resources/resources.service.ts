import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { UserRole } from '../generated/prisma/enums.js';
import type { ResourceContent } from './resources.input.js';

export const resourceSummarySelect = {
  id: true,
  title: true,
  subject: true,
  grade: true,
  retiredAt: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;
export const resourceDetailSelect = {
  ...resourceSummarySelect,
  sourceReference: true,
  contentText: true,
} as const;

export class ResourcesService {
  constructor(private readonly db: PrismaClient) {}
  private admin(role: UserRole) {
    if (role !== 'ADMIN') throw new ForbiddenException('Forbidden.');
  }
  async list(role: UserRole, limit: number, after?: string) {
    const rows = await this.db.curriculumResource.findMany({
      where: {
        ...(role === 'ADMIN' ? {} : { retiredAt: null }),
        ...(after ? { id: { gt: after } } : {}),
      },
      select: resourceSummarySelect,
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    const items = rows.slice(0, limit);
    return { items, nextAfter: rows.length > limit ? items.at(-1)!.id : null };
  }
  async detail(role: UserRole, id: string) {
    const row = await this.db.curriculumResource.findFirst({
      where: { id, ...(role === 'ADMIN' ? {} : { retiredAt: null }) },
      select: resourceDetailSelect,
    });
    if (!row) throw new NotFoundException('Not found.');
    return row;
  }
  create(role: UserRole, content: ResourceContent) {
    this.admin(role);
    // Assign only content fields, even if a future caller passes a wider object.
    return this.db.curriculumResource.create({
      data: this.content(content),
      select: resourceDetailSelect,
    });
  }
  private content(input: ResourceContent): ResourceContent {
    return {
      title: input.title,
      subject: input.subject,
      grade: input.grade,
      sourceReference: input.sourceReference,
      contentText: input.contentText,
    };
  }
  async mutate(
    role: UserRole,
    id: string,
    version: number,
    content?: ResourceContent,
  ) {
    this.admin(role);
    return this.db.$transaction(
      async (tx) => {
        // All resource mutations share this lock, including future snapshot selection.
        const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "CurriculumResource" WHERE id = ${id}::uuid FOR UPDATE
      `;
        if (!rows.length) throw new NotFoundException('Not found.');
        const current = await tx.curriculumResource.findUniqueOrThrow({
          where: { id },
          select: resourceDetailSelect,
        });
        if (current.version !== version || (content && current.retiredAt))
          throw new ConflictException('Resource conflict.');
        if (!content && current.retiredAt) return current;
        if (current.version === 2147483647)
          throw new ConflictException('Resource conflict.');
        return tx.curriculumResource.update({
          where: { id },
          data: {
            ...(content ? this.content(content) : { retiredAt: new Date() }),
            version: { increment: 1 },
          },
          select: resourceDetailSelect,
        });
      },
      { maxWait: 5000, timeout: 5000 },
    );
  }
}
