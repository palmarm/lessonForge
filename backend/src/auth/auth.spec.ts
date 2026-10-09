import { Logger } from '@nestjs/common';
import { PasswordService, supportedHash } from './password.service.js';
import { resolveAuthConfig } from './auth.config.js';
import { canonicalEmail, loginInput } from './auth.input.js';
import { AuthService, LoginFailure } from './auth.service.js';
import { AuthRepository, type LoginUser } from './auth.repository.js';
import { BoundedThrottleStorage } from './auth.rate-limit.js';
import { newToken, tokenHash } from './auth.cookies.js';

it('verifies a real Argon2id hash with the installed native binary and exact parameters', async () => {
  const passwords = new PasswordService();
  await passwords.onModuleInit();
  const hash = await passwords.hash(' Unicode 🔒 fixture password ');
  expect(supportedHash(hash)).toBe(true);
  expect(await passwords.verify(hash, ' Unicode 🔒 fixture password ')).toBe(
    true,
  );
  expect(await passwords.verify(hash, 'Unicode 🔒 fixture password')).toBe(
    false,
  );
  expect(
    await passwords.verify(undefined, ' Unicode 🔒 fixture password '),
  ).toBe(false);
  const log = vi
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  expect(
    await passwords.verify(
      hash.replace('m=65536', 'm=999999999'),
      'irrelevant',
    ),
  ).toBe(false);
  expect(log).toHaveBeenCalledWith(
    'Unsupported stored password hash; authentication refused.',
  );
  log.mockRestore();
  await passwords.onModuleDestroy();
}, 20000);

it('bounds native work to two operations plus eight queued and drains before shutdown', async () => {
  const passwords = new PasswordService();
  const work = vi.fn();
  const releases: (() => void)[] = [];
  // Exercise the semaphore with controlled work; the preceding test covers native Argon2.
  const bounded = passwords as unknown as {
    bounded: <T>(job: () => Promise<T>) => Promise<T>;
  };
  const jobs = Array.from({ length: 10 }, () =>
    bounded.bounded(() => {
      work();
      return new Promise<void>((resolve) => releases.push(resolve));
    }),
  );
  expect(work).toHaveBeenCalledTimes(2);
  await expect(bounded.bounded(async () => undefined)).rejects.toThrow(
    'Service unavailable.',
  );
  let drained = false;
  const closing = passwords.onModuleDestroy().then(() => {
    drained = true;
  });
  await expect(passwords.hash('rejected during shutdown')).rejects.toThrow(
    'Service unavailable.',
  );
  expect(drained).toBe(false);
  for (let i = 0; i < 10; i++) {
    releases.shift()!();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
  await Promise.all(jobs);
  await closing;
  expect(drained).toBe(true);
});

it.each([
  { AUTH_COOKIE_MODE: 'local-http', NODE_ENV: 'production' },
  { API_PUBLIC_ORIGIN: 'http://example.test:3001' },
  { AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:3000' },
  { AUTH_ALLOWED_ORIGINS: 'http://localhost:3000/' },
  { AUTH_ALLOWED_ORIGINS: 'http://localhost:3000,http://localhost:3000' },
  { AUTH_ALLOWED_ORIGINS: '*' },
  { API_PUBLIC_ORIGIN: 'http://secret:password@localhost:3001' },
  {
    AUTH_COOKIE_MODE: 'https',
    AUTH_ALLOWED_ORIGINS: 'https://ui.example.test',
    API_PUBLIC_ORIGIN: 'http://api.example.test',
  },
])(
  'rejects unsafe cookie/origin configuration without reflecting values',
  (env) => {
    expect(() => resolveAuthConfig(env)).toThrow(
      'Invalid authentication origin or cookie configuration.',
    );
  },
);
it('accepts local defaults and explicit HTTPS origins', () => {
  expect(resolveAuthConfig({}).cookieName).toBe('lessonforge_session');
  expect(
    resolveAuthConfig({
      NODE_ENV: 'production',
      AUTH_COOKIE_MODE: 'https',
      API_PUBLIC_ORIGIN: 'https://api.example.test',
      AUTH_ALLOWED_ORIGINS: 'https://ui.example.test',
    }).cookieName,
  ).toBe('__Host-lessonforge_session');
});
it.each([
  null,
  [],
  { email: 'a@b.test' },
  { email: 'a@b.test', password: 'x', role: 'ADMIN' },
  { email: 'a b@b.test', password: 'x' },
  { email: 'a@b.test', password: '' },
  { email: 'a@b.test', password: 'x'.repeat(129) },
  { email: 'a@b.test', password: 'x\0' },
  { email: 'a@b.test', password: 1 },
  { email: 'é@b.test', password: 'x' },
])('bounds login shape and credentials (%j)', (value) => {
  expect(() => loginInput(value)).toThrow('Invalid request.');
});
it('canonicalizes email without changing a Unicode password', () => {
  expect(
    loginInput({ email: ' Teacher@Example.test ', password: ' x 🔒 ' }),
  ).toEqual({ email: 'teacher@example.test', password: ' x 🔒 ' });
  expect(canonicalEmail('a\n@b.test')).toBeUndefined();
});
it('uses random canonical 256-bit tokens and stores only lowercase SHA-256', () => {
  const a = newToken();
  const b = newToken();
  expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(Buffer.from(a, 'base64url')).toHaveLength(32);
  expect(a).not.toBe(b);
  expect(tokenHash(a)).toMatch(/^[0-9a-f]{64}$/);
});
it('limits live tracker keys, does not extend rejection, and prunes expired keys', async () => {
  let now = 0;
  const storage = new BoundedThrottleStorage(() => now, 1);
  const hit = (key: string) => storage.increment(key, 1000, 1, 1000, 'test');
  expect((await hit('a')).isBlocked).toBe(false);
  expect((await hit('a')).isBlocked).toBe(true);
  await expect(async () => hit('b')).rejects.toThrow('Service unavailable.');
  now = 1000;
  expect((await hit('b')).isBlocked).toBe(false);
  storage.onApplicationShutdown();
  expect((await hit('a')).isBlocked).toBe(false);
});
it('does not rotate on failed password verification and retries only token collisions, at most three times', async () => {
  const user = {
    id: 'fixture',
    email: 'a@b.test',
    displayName: 'Teacher',
    role: 'TEACHER',
    passwordHash: 'hash',
  } as LoginUser;
  const repository = {
    findLoginUser: vi.fn(async () => user),
    rotate: vi.fn(),
  };
  const passwords = { verify: vi.fn(async () => false) };
  const service = new AuthService(
    repository as unknown as AuthRepository,
    passwords as unknown as PasswordService,
  );
  await expect(service.login(user.email, 'incorrect')).rejects.toBeInstanceOf(
    LoginFailure,
  );
  expect(repository.rotate).not.toHaveBeenCalled();
  passwords.verify.mockResolvedValue(true);
  const collision = {
    meta: {
      driverAdapterError: {
        cause: {
          originalCode: '23505',
          constraint: { index: 'Session_tokenHash_key' },
        },
      },
    },
  };
  repository.rotate.mockRejectedValue(collision);
  await expect(service.login(user.email, 'correct')).rejects.toThrow(
    'Service unavailable.',
  );
  expect(repository.rotate).toHaveBeenCalledTimes(3);
  expect(
    new Set(repository.rotate.mock.calls.map((args: unknown[]) => args[1]))
      .size,
  ).toBe(3);
  repository.rotate.mockReset().mockRejectedValue({
    meta: { driverAdapterError: { cause: { originalCode: '23503' } } },
  });
  await expect(service.login(user.email, 'correct')).rejects.toEqual(
    expect.objectContaining({ meta: expect.anything() }),
  );
  expect(repository.rotate).toHaveBeenCalledOnce();
});

it('refuses a late successful KDF result during shutdown without starting rotation', async () => {
  const user = {
    id: 'fixture',
    email: 'a@b.test',
    displayName: 'Teacher',
    role: 'TEACHER',
    passwordHash: 'hash',
  } as LoginUser;
  const repository = {
    findLoginUser: vi.fn(async () => user),
    rotate: vi.fn(),
  };
  let finish!: (valid: boolean) => void;
  const passwords = {
    verify: vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    ),
  };
  const service = new AuthService(
    repository as unknown as AuthRepository,
    passwords as unknown as PasswordService,
  );
  const login = service.login(user.email, 'correct');
  await vi.waitFor(() => expect(passwords.verify).toHaveBeenCalledOnce());
  service.onModuleDestroy();
  finish(true);
  await expect(login).rejects.toThrow('Service unavailable.');
  await expect(service.login(user.email, 'correct')).rejects.toThrow(
    'Service unavailable.',
  );
  expect(repository.rotate).not.toHaveBeenCalled();
  expect(repository.findLoginUser).toHaveBeenCalledOnce();
});
