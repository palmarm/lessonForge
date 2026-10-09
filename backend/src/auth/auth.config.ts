import { ConfigurationError } from '../config/environment.js';

export class AuthConfig {
  constructor(
    readonly apiOrigin: string,
    readonly allowedOrigins: readonly string[],
    readonly secure: boolean,
  ) {}
  get cookieName(): string {
    return this.secure ? '__Host-lessonforge_session' : 'lessonforge_session';
  }
}

export function resolveAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const invalid = () =>
    new ConfigurationError(
      'Invalid authentication origin or cookie configuration.',
    );
  const mode = env.AUTH_COOKIE_MODE ?? 'local-http';
  if (
    !['local-http', 'https'].includes(mode) ||
    (env.NODE_ENV === 'production' && mode !== 'https')
  )
    throw invalid();
  const parse = (value: string): URL => {
    try {
      const url = new URL(value);
      if (
        url.origin !== value ||
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hash ||
        url.search
      )
        throw invalid();
      return url;
    } catch {
      throw invalid();
    }
  };
  const api = parse(env.API_PUBLIC_ORIGIN ?? 'http://localhost:3001');
  const allowed = (env.AUTH_ALLOWED_ORIGINS ?? 'http://localhost:3000').split(
    ',',
  );
  if (!allowed.length || new Set(allowed).size !== allowed.length)
    throw invalid();
  for (const url of [api, ...allowed.map(parse)]) {
    if (
      mode === 'https'
        ? url.protocol !== 'https:'
        : url.protocol !== 'http:' ||
          !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
          url.hostname !== api.hostname
    )
      throw invalid();
  }
  return new AuthConfig(api.origin, Object.freeze(allowed), mode === 'https');
}
