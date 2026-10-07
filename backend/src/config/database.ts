import { ConfigurationError } from './environment.js';

export function resolveDatabaseUrl(value: string | undefined): string {
  const invalid = () =>
    new ConfigurationError(
      'DATABASE_URL must be a PostgreSQL URL with host, database, username and password; only sslmode query configuration is supported.',
    );
  if (!value || value !== value.trim()) throw invalid();
  try {
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.password ||
      url.pathname.length < 2 ||
      url.pathname.slice(1).includes('/') ||
      url.hash ||
      (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)) ||
      [...url.searchParams.keys()].some((key) => key !== 'sslmode') ||
      url.searchParams.getAll('sslmode').length > 1 ||
      (url.searchParams.has('sslmode') &&
        !['disable', 'require', 'verify-ca', 'verify-full'].includes(
          url.searchParams.get('sslmode')!,
        ))
    )
      throw invalid();
    // Reject malformed percent escapes without including their input in errors.
    for (const component of [url.username, url.password, url.pathname])
      decodeURIComponent(component);
    return value;
  } catch {
    throw invalid();
  }
}

export function assertLocalDevelopmentDatabase(value: string): void {
  const url = new URL(resolveDatabaseUrl(value));
  if (
    url.hostname !== '127.0.0.1' ||
    url.port !== '5433' ||
    url.pathname !== '/lessonforge_dev' ||
    url.search
  ) {
    throw new ConfigurationError(
      'test:db requires 127.0.0.1:5433/lessonforge_dev without URL query parameters.',
    );
  }
}
