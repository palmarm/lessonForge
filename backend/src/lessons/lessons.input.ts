import { BadRequestException } from '@nestjs/common';
import { exactObject, expectedVersion } from '../resources/resources.input.js';

export type DraftContent = {
  title?: string;
  subject?: 'Mathematics';
  grade?: 'Grade 4';
  durationMinutes?: number;
  learningObjectives?: string[];
  materials?: string[];
  introduction?: { text?: string; durationMinutes?: number };
  activities?: {
    teacherTasks?: string;
    learnerTasks?: string;
    durationMinutes?: number;
  }[];
  assessment?: { text?: string; durationMinutes?: number };
  differentiation?: { learnerSupport?: string; extensionActivities?: string };
};
const invalid = () => new BadRequestException('Invalid draft.');
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalid();
  if (Object.keys(value).some((key) => !keys.includes(key))) throw invalid();
  return value as Record<string, unknown>;
}
const text = (value: unknown, max: number) => {
  if (typeof value !== 'string' || value.length > max || value.includes('\0'))
    throw invalid();
};
const timing = (value: unknown) => {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 1440
  )
    throw invalid();
};
// Structural draft validity only: deliberately no submission completeness or timing-sum rule.
export function draftContent(value: unknown): DraftContent {
  const input = object(value, [
    'title',
    'subject',
    'grade',
    'durationMinutes',
    'learningObjectives',
    'materials',
    'introduction',
    'activities',
    'assessment',
    'differentiation',
  ]);
  for (const [key, field] of Object.entries(input)) {
    switch (key) {
      case 'title':
        text(field, 200);
        break;
      case 'subject':
        if (field !== 'Mathematics') throw invalid();
        break;
      case 'grade':
        if (field !== 'Grade 4') throw invalid();
        break;
      case 'durationMinutes':
        timing(field);
        break;
      case 'learningObjectives':
      case 'materials':
        if (!Array.isArray(field) || field.length > 30) throw invalid();
        field.forEach((entry: unknown) =>
          text(entry, key === 'materials' ? 500 : 1000),
        );
        break;
      case 'introduction':
      case 'assessment': {
        const section = object(field, ['text', 'durationMinutes']);
        if (Object.hasOwn(section, 'text')) text(section.text, 4000);
        if (Object.hasOwn(section, 'durationMinutes'))
          timing(section.durationMinutes);
        break;
      }
      case 'activities':
        if (!Array.isArray(field) || field.length > 30) throw invalid();
        field.forEach((entry: unknown) => {
          const activity = object(entry, [
            'teacherTasks',
            'learnerTasks',
            'durationMinutes',
          ]);
          for (const [k, v] of Object.entries(activity)) {
            if (k === 'durationMinutes') timing(v);
            else text(v, 4000);
          }
        });
        break;
      case 'differentiation':
        Object.values(
          object(field, ['learnerSupport', 'extensionActivities']),
        ).forEach((v) => text(v, 4000));
    }
  }
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 65536) throw invalid();
  return input as DraftContent;
}
export function lessonInput(body: unknown, saving = false) {
  const value = exactObject(
    body,
    saving ? ['content', 'expectedVersion'] : ['content'],
  );
  return {
    content: draftContent(value.content),
    ...(saving
      ? { expectedVersion: expectedVersion(value.expectedVersion) }
      : {}),
  };
}
