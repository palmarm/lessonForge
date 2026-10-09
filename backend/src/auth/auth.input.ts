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
  if (
    !canonical ||
    typeof password !== 'string' ||
    !password.length ||
    Array.from(password).length > 128 ||
    Buffer.byteLength(password, 'utf8') > 512 ||
    password.includes('\0')
  )
    throw invalid();
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
