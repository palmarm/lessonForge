import { BadRequestException } from '@nestjs/common';

export function canonicalEmail(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 254) return undefined;
  const email = value.trim().toLowerCase();
  if (
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(
      email,
    ) ||
    email.length > 254
  )
    return undefined;
  return email;
}

export function validPassword(value: unknown, minimum = 1): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 256 &&
    Buffer.byteLength(value, 'utf8') <= 512 &&
    Array.from(value).length >= minimum &&
    Array.from(value).length <= 128 &&
    !value.includes('\0')
  );
}

export function loginInput(body: unknown): { email: string; password: string } {
  const invalid = () => new BadRequestException('Invalid request.');
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).sort().join(',') !== 'email,password'
  )
    throw invalid();
  const { email, password } = body as Record<string, unknown>;
  const canonical = canonicalEmail(email);
  if (!canonical || !validPassword(password)) throw invalid();
  return { email: canonical, password };
}

export function emptyInput(body: unknown): void {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length
  )
    throw new BadRequestException('Invalid request.');
}
