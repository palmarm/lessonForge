import { canonicalEmail, validPassword } from './auth.input.js';
import { resolveDatabaseUrl } from '../config/database.js';

export class ProvisioningError extends Error {}
export class ProvisioningCancelled extends Error {}
export function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ProvisioningCancelled();
}

export function resolveProvisioningDatabaseUrl(
  value: string | undefined,
): string {
  try {
    const validated = resolveDatabaseUrl(value);
    const url = new URL(validated);
    if (
      url.hostname !== '127.0.0.1' ||
      url.port !== '5433' ||
      url.pathname !== '/lessonforge_dev' ||
      url.search ||
      validated.includes('?')
    )
      throw new Error();
    return validated;
  } catch {
    throw new ProvisioningError(
      'Provisioning requires 127.0.0.1:5433/lessonforge_dev without URL query parameters.',
    );
  }
}

export const accountKeys = ['teacher', 'admin'] as const;
export type AccountKey = (typeof accountKeys)[number];
export type AccountTarget = {
  key: AccountKey;
  email: string;
  displayName: string;
  role: 'TEACHER' | 'ADMIN';
};
export type AccountCredentials = Partial<Record<AccountKey, string>>;

export function accountTargets(input: unknown): AccountTarget[] {
  const invalid = () =>
    new ProvisioningError(
      'Supply valid, distinct teacher and administrator account details.',
    );
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw invalid();
  const targets = accountKeys.map((key): AccountTarget => {
    const value = (input as Record<string, unknown>)[key];
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw invalid();
    const { email, displayName } = value as Record<string, unknown>;
    const canonical = canonicalEmail(email);
    if (typeof displayName !== 'string' || !canonical) throw invalid();
    const name = displayName.trim();
    if (
      !name ||
      Array.from(name).length > 80 ||
      Buffer.byteLength(name, 'utf8') > 320
    )
      throw invalid();
    return {
      key,
      email: canonical,
      displayName: name,
      role: key === 'teacher' ? 'TEACHER' : 'ADMIN',
    };
  });
  if (targets[0].email === targets[1].email) throw invalid();
  return targets;
}

export function provisioningPassword(value: unknown): string {
  if (!validPassword(value, 15))
    throw new ProvisioningError(
      'Passwords require 15–128 Unicode code points, at most 512 UTF-8 bytes, and no NUL.',
    );
  return value;
}
