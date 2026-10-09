import { resolveConstraintDatabaseUrl } from './support/constraint-database.js';

const fixture =
  'postgresql://lessonforge_constraints:fixture@127.0.0.1:5434/lessonforge_constraints_test';

it('accepts only an explicitly acknowledged disposable database URL', () => {
  expect(resolveConstraintDatabaseUrl(fixture, 'disposable')).toBe(fixture);
});

it.each([
  undefined,
  '',
  fixture.replace('5434', '5433'),
  fixture.replace('lessonforge_constraints_test', 'lessonforge_dev'),
  fixture.replace('127.0.0.1', 'localhost'),
  fixture.replace('127.0.0.1', 'example.com'),
  fixture.replace('lessonforge_constraints:fixture', 'lessonforge:fixture'),
  `${fixture}?sslmode=disable`,
  `${fixture}?host=127.0.0.1`,
  `${fixture}#fragment`,
  fixture.replace(':fixture@', ':@'),
  fixture.replace(':fixture@', ':%invalid@'),
  fixture.replace('postgresql:', 'https:'),
  ` ${fixture}`,
])('rejects an unsafe target without revealing the supplied URL', (value) => {
  try {
    resolveConstraintDatabaseUrl(value, 'disposable');
    throw new Error('Unexpectedly accepted unsafe target');
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('test:constraints requires');
    expect(message).not.toContain('fixture');
    expect(message).not.toContain('%invalid');
  }
});

it.each([undefined, '', 'true'])(
  'requires disposal acknowledgement',
  (value) => {
    expect(() => resolveConstraintDatabaseUrl(fixture, value)).toThrow(
      'LESSONFORGE_CONSTRAINT_TEST=disposable',
    );
  },
);
