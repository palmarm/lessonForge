import { ConfigurationError } from '../../src/config/environment.js';
import { resolveDatabaseUrl } from '../../src/config/database.js';

// This command mutates only an explicitly acknowledged disposable target.
// It never loads .env or falls back to DATABASE_URL.
export function resolveConstraintDatabaseUrl(
  value: string | undefined,
  acknowledgement: string | undefined,
): string {
  const invalid = () =>
    new ConfigurationError(
      'test:constraints requires CONSTRAINT_TEST_DATABASE_URL targeting lessonforge_constraints@127.0.0.1:5434/lessonforge_constraints_test without query parameters, and LESSONFORGE_CONSTRAINT_TEST=disposable.',
    );
  try {
    if (acknowledgement !== 'disposable') throw invalid();
    const url = new URL(resolveDatabaseUrl(value));
    if (
      url.hostname !== '127.0.0.1' ||
      url.port !== '5434' ||
      url.pathname !== '/lessonforge_constraints_test' ||
      url.username !== 'lessonforge_constraints' ||
      url.search
    )
      throw invalid();
    return value!;
  } catch {
    // Do not echo supplied URLs, passwords, or driver errors.
    throw invalid();
  }
}
