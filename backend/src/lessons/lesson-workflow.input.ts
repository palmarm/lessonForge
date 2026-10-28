import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  exactObject,
  expectedVersion,
  resourceId,
  resourceInput,
} from '../resources/resources.input.js';
import { draftContent } from './lessons.input.js';

const invalid = () => new BadRequestException('Invalid submission.');
const nonblank = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export function submissionContent(value: unknown) {
  const content = draftContent(value);
  if (
    !nonblank(content.title) ||
    content.subject !== 'Mathematics' ||
    content.grade !== 'Grade 4' ||
    !content.durationMinutes ||
    !content.learningObjectives?.length ||
    !content.learningObjectives.every(nonblank) ||
    !content.materials ||
    !content.materials.every(nonblank) ||
    !nonblank(content.introduction?.text) ||
    !content.introduction?.durationMinutes ||
    !content.activities?.length ||
    !content.activities.every(
      (activity) =>
        nonblank(activity.teacherTasks) &&
        nonblank(activity.learnerTasks) &&
        !!activity.durationMinutes,
    ) ||
    !nonblank(content.assessment?.text) ||
    !content.assessment?.durationMinutes ||
    !nonblank(content.differentiation?.learnerSupport) ||
    !nonblank(content.differentiation?.extensionActivities)
  )
    throw invalid();
  const total =
    content.introduction.durationMinutes +
    content.activities.reduce(
      (sum, activity) => sum + activity.durationMinutes!,
      0,
    ) +
    content.assessment.durationMinutes;
  if (total !== content.durationMinutes) throw invalid();
  return content;
}

export type TrustedSource = {
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

// Internal persisted data only. Validate without normalizing or recapturing snapshots.
export function trustedSources(value: unknown): TrustedSource[] {
  try {
    if (!Array.isArray(value) || value.length > 5) throw invalid();
    const ids = new Set<string>();
    for (const source of value) {
      const input = exactObject(source, [
        'resourceId',
        'resourceVersion',
        'snapshot',
      ]);
      const id = resourceId(input.resourceId);
      if (id !== input.resourceId || ids.has(id)) throw invalid();
      ids.add(id);
      expectedVersion(input.resourceVersion);
      resourceInput(input.snapshot);
    }
    return value as TrustedSource[];
  } catch {
    throw new ServiceUnavailableException('Invalid stored sources.');
  }
}

export function reviewInput(body: unknown) {
  const hasFeedback =
    !!body && typeof body === 'object' && Object.hasOwn(body, 'feedback');
  const input = exactObject(body, [
    'expectedVersion',
    'decision',
    ...(hasFeedback ? ['feedback'] : []),
  ]);
  if (input.decision !== 'APPROVE' && input.decision !== 'REQUEST_CHANGES')
    throw invalid();
  const raw = input.feedback;
  if (
    raw !== undefined &&
    raw !== null &&
    (typeof raw !== 'string' || raw.length > 4000 || raw.includes('\0'))
  )
    throw invalid();
  const feedback = typeof raw === 'string' ? raw.trim() || null : null;
  if (input.decision === 'REQUEST_CHANGES' && !feedback) throw invalid();
  return {
    expectedVersion: expectedVersion(input.expectedVersion),
    decision: input.decision as 'APPROVE' | 'REQUEST_CHANGES',
    feedback,
  };
}
