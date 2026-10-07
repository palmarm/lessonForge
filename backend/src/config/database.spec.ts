import {
  assertLocalDevelopmentDatabase,
  resolveDatabaseUrl,
} from './database.js';

const local =
  'postgresql://lessonforge:fixture-password@127.0.0.1:5433/lessonforge_dev';

describe('database configuration', () => {
  it('accepts a direct PostgreSQL URL and encoded password', () => {
    expect(resolveDatabaseUrl(local)).toBe(local);
    expect(
      resolveDatabaseUrl(local.replace('fixture-password', 'pass%40word')),
    ).toContain('pass%40word');
  });

  it.each([
    undefined,
    '',
    'secret-invalid-input',
    'https://user:secret@localhost/db',
    'postgresql://user@localhost/db',
    'postgresql://user:secret@localhost/',
    'postgresql://user:secret@localhost:0/db',
    'postgresql://user:secret@localhost/db#secret',
    'postgresql://user:secret@localhost/db?host=remote',
    'postgresql://user:%ZZ@localhost/db',
    ` ${local}`,
    `${local}?sslmode=unknown`,
  ])('rejects malformed or incomplete input without exposing it', (value) => {
    expect(() => resolveDatabaseUrl(value)).toThrow('DATABASE_URL must be');
    try {
      resolveDatabaseUrl(value);
    } catch (error) {
      expect(String(error)).not.toContain('secret');
      expect(String(error)).not.toContain('fixture-password');
    }
  });

  it('permits supported TLS configuration for runtime', () => {
    expect(resolveDatabaseUrl(`${local}?sslmode=verify-full`)).toContain(
      'verify-full',
    );
  });

  it('permits only the fixed local database for the live test', () => {
    expect(() => assertLocalDevelopmentDatabase(local)).not.toThrow();
  });

  it.each([
    local.replace('127.0.0.1', 'example.com'),
    local.replace('127.0.0.1', 'localhost'),
    local.replace('5433', '5432'),
    local.replace(':5433', ''),
    local.replace('lessonforge_dev', 'production'),
    `${local}?sslmode=disable`,
    `${local}?host=example.com`,
  ])('rejects other live-test targets', (value) => {
    expect(() => assertLocalDevelopmentDatabase(value)).toThrow();
  });
});
