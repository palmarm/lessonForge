import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { Request, Response, CookieOptions } from 'express';
import type { AuthConfig } from './auth.config.js';

export const newToken = (): string => randomBytes(32).toString('base64url');
export const tokenHash = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
export function sessionToken(
  req: Request,
  config: AuthConfig,
): string | undefined {
  const matches = (req.headers.cookie ?? '').split(';').filter((item) => {
    const equals = item.indexOf('=');
    // cookie-parser's cookie.parse trims SP/HTAB around names and ignores
    // entries without '='. Count duplicates the same way before selection.
    return (
      equals !== -1 &&
      item.slice(0, equals).replace(/^[ \t]+|[ \t]+$/g, '') ===
        config.cookieName
    );
  });
  if (matches.length > 1) throw new BadRequestException('Invalid request.');
  const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[
    config.cookieName
  ];
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(value) ||
    Buffer.from(value, 'base64url').toString('base64url') !== value
  )
    return undefined;
  return value;
}
function options(config: AuthConfig): CookieOptions {
  return { httpOnly: true, secure: config.secure, sameSite: 'lax', path: '/' };
}
export function setSessionCookie(
  res: Response,
  config: AuthConfig,
  token: string,
): void {
  res.cookie(config.cookieName, token, {
    ...options(config),
    maxAge: 8 * 60 * 60 * 1000,
  });
}
export function clearSessionCookie(res: Response, config: AuthConfig): void {
  res.clearCookie(config.cookieName, options(config));
}
