import type { DraftContent } from '../../src/lessons/lessons.input.js';

export const completeContent = {
  title: '  Equal parts  ',
  subject: 'Mathematics',
  grade: 'Grade 4',
  durationMinutes: 35,
  learningObjectives: ['Identify equal parts'],
  materials: [],
  introduction: { text: 'Discuss sharing.', durationMinutes: 5 },
  activities: [
    {
      teacherTasks: 'Model halves.',
      learnerTasks: 'Fold paper.',
      durationMinutes: 10,
    },
    {
      teacherTasks: 'Ask for quarters.',
      learnerTasks: 'Explain parts.',
      durationMinutes: 15,
    },
  ],
  assessment: { text: 'Identify one half.', durationMinutes: 5 },
  differentiation: {
    learnerSupport: 'Use a model.',
    extensionActivities: 'Compare quarters.',
  },
} satisfies DraftContent;
