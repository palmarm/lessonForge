import { BadRequestException } from '@nestjs/common';

export type ResourceContent = {
  title: string;
  subject: 'Mathematics';
  grade: 'Grade 4';
  sourceReference: string;
  contentText: string;
};
const fields = ['title', 'subject', 'grade', 'sourceReference', 'contentText'];
export const resourceLimits = {
  title: 200,
  sourceReference: 1000,
  contentText: 20000,
};
export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = () => new BadRequestException('Invalid request.');

export function exactObject(
  value: unknown,
  expected: string[],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalid();
  const object = value as Record<string, unknown>;
  if (
    Object.keys(object).length !== expected.length ||
    !expected.every((key) => Object.hasOwn(object, key))
  )
    throw invalid();
  return object;
}
export function resourceId(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw invalid();
  return value.toLowerCase();
}
export function expectedVersion(value: unknown): number {
  // Accept the full positive PostgreSQL int range. Exhausted counters cannot mutate.
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 2147483647
  )
    throw invalid();
  return value;
}
export function resourceInput(
  body: unknown,
  editing = false,
): ResourceContent & { expectedVersion?: number } {
  const value = exactObject(
    body,
    editing ? [...fields, 'expectedVersion'] : fields,
  );
  const text = (key: keyof typeof resourceLimits): string => {
    const input = value[key];
    if (
      typeof input !== 'string' ||
      !input.trim() ||
      input.length > resourceLimits[key] ||
      input.includes('\0')
    )
      throw invalid();
    return input.trim();
  };
  if (value.subject !== 'Mathematics' || value.grade !== 'Grade 4')
    throw invalid();
  return {
    title: text('title'),
    subject: 'Mathematics',
    grade: 'Grade 4',
    sourceReference: text('sourceReference'),
    contentText: text('contentText'),
    ...(editing
      ? { expectedVersion: expectedVersion(value.expectedVersion) }
      : {}),
  };
}
export function retirementInput(body: unknown): number {
  return expectedVersion(
    exactObject(body, ['expectedVersion']).expectedVersion,
  );
}
export function resourceQuery(query: Record<string, unknown>): {
  limit: number;
  after?: string;
} {
  if (Object.keys(query).some((key) => !['limit', 'after'].includes(key)))
    throw invalid();
  let limit = 20;
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^[1-9]\d?$/.test(query.limit))
      throw invalid();
    limit = Number(query.limit);
    if (limit > 50) throw invalid();
  }
  return {
    limit,
    ...(query.after !== undefined ? { after: resourceId(query.after) } : {}),
  };
}
