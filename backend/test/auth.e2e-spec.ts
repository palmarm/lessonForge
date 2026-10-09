import { Controller, Get, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthConfig, resolveAuthConfig } from '../src/auth/auth.config.js';
import { configureAuthHttp } from '../src/auth/auth.http.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { PasswordService } from '../src/auth/password.service.js';
import { BoundedThrottleStorage } from '../src/auth/auth.rate-limit.js';
import { Roles } from '../src/auth/auth.guards.js';
import { newToken, tokenHash } from '../src/auth/auth.cookies.js';

@Controller('protected')
class ProtectedController {
  @Get() normal() {
    return 'protected';
  }
  @Get('teacher') @Roles('TEACHER') teacher() {
    return 'teacher';
  }
  @Get('admin') @Roles('ADMIN') admin() {
    return 'admin';
  }
}
@Module({ imports: [AppModule], controllers: [ProtectedController] })
class HttpFixtureModule {}

const user = {
  id: randomUUID(),
  email: 'teacher@example.test',
  displayName: 'Teacher',
  role: 'TEACHER' as const,
};
const principal = { user, expiresAt: new Date('2030-01-01T08:00:00Z') };
const loginUser = { ...user, passwordHash: 'private-hash-must-not-leak' };
const repository = {
  findLoginUser: vi.fn(),
  rotate: vi.fn(),
  authenticate: vi.fn(),
  revoke: vi.fn(),
};
const passwords = { verify: vi.fn() };
const token = newToken();
let app: NestExpressApplication;
let config: AuthConfig;
let storage: BoundedThrottleStorage;

async function open(settings = resolveAuthConfig({})) {
  config = settings;
  storage = new BoundedThrottleStorage();
  const fixture = await Test.createTestingModule({
    imports: [HttpFixtureModule],
  })
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(AuthConfig)
    .useValue(config)
    .overrideProvider(AuthRepository)
    .useValue(repository)
    .overrideProvider(PasswordService)
    .useValue(passwords)
    .overrideProvider(BoundedThrottleStorage)
    .useValue(storage)
    .compile();
  app = fixture.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  configureAuthHttp(app, config);
  await app.init();
}
function post(path: string, email = user.email) {
  return request(app.getHttpServer())
    .post(path)
    .set('Origin', config.allowedOrigins[0])
    .set('X-LessonForge-CSRF', '1')
    .send(
      path === '/auth/login' ? { email, password: 'fixture password' } : {},
    );
}
function cookie() {
  return `${config.cookieName}=${token}`;
}
beforeEach(async () => {
  vi.resetAllMocks();
  repository.findLoginUser.mockResolvedValue(loginUser);
  repository.rotate.mockResolvedValue(principal);
  repository.authenticate.mockResolvedValue(principal);
  passwords.verify.mockResolvedValue(true);
  await open();
});
afterEach(async () => {
  await app.close();
});

it('protects routes by default, accepts root publicly, and does not refresh activity on public routes', async () => {
  await request(app.getHttpServer())
    .get('/')
    .set('Cookie', cookie())
    .expect(200, 'LessonForge API');
  await request(app.getHttpServer()).get('/protected').expect(401);
  await request(app.getHttpServer()).get('/auth/me').expect(401);
  expect(repository.authenticate).not.toHaveBeenCalled();
  await request(app.getHttpServer())
    .get('/protected')
    .set('Cookie', cookie())
    .expect(200);
  expect(repository.authenticate).toHaveBeenCalledWith(tokenHash(token));
});
it('runs authentication before role checks and accepts the matching teacher/admin', async () => {
  await request(app.getHttpServer()).get('/protected/admin').expect(401);
  await request(app.getHttpServer())
    .get('/protected/teacher')
    .set('Cookie', cookie())
    .expect(200);
  await request(app.getHttpServer())
    .get('/protected/admin')
    .set('Cookie', cookie())
    .expect(403);
  expect(repository.authenticate).toHaveBeenCalledTimes(2);
  repository.authenticate.mockResolvedValue({
    ...principal,
    user: { ...user, role: 'ADMIN' },
  });
  await request(app.getHttpServer())
    .get('/protected/admin')
    .set('Cookie', cookie())
    .expect(200);
  await request(app.getHttpServer())
    .get('/protected/teacher')
    .set('Cookie', cookie())
    .expect(403);
});
it('returns a safe projection and sets a local opaque cookie only after rotation', async () => {
  const response = await post('/auth/login', ' Teacher@Example.test ').expect(
    200,
  );
  expect(response.body).toEqual({
    user,
    expiresAt: principal.expiresAt.toISOString(),
  });
  expect(repository.findLoginUser).toHaveBeenCalledWith(user.email);
  const header = response.headers['set-cookie'][0] as string;
  expect(header).toMatch(/^lessonforge_session=[A-Za-z0-9_-]{43};/);
  expect(header).toContain('HttpOnly');
  expect(header).toContain('Path=/');
  expect(header).toContain('SameSite=Lax');
  expect(header).toContain('Max-Age=28800');
  expect(header).not.toContain('Secure');
  expect(header).not.toContain('Domain=');
  expect(response.headers['cache-control']).toBe('no-store');
  expect(JSON.stringify(response.body)).not.toContain('hash');
  const me = await request(app.getHttpServer())
    .get('/auth/me')
    .set('Cookie', cookie())
    .expect(200);
  expect(me.body).toEqual(response.body);
});
it('uses a __Host- Secure HttpOnly cookie and matching clear policy in HTTPS mode', async () => {
  await app.close();
  await open(
    resolveAuthConfig({
      AUTH_COOKIE_MODE: 'https',
      NODE_ENV: 'production',
      API_PUBLIC_ORIGIN: 'https://api.example.test',
      AUTH_ALLOWED_ORIGINS: 'https://ui.example.test',
    }),
  );
  const response = await post('/auth/login').expect(200);
  expect(response.headers['set-cookie'][0]).toMatch(
    /^__Host-lessonforge_session=/,
  );
  expect(response.headers['set-cookie'][0]).toContain('Secure');
  const logout = await post('/auth/logout').set('Cookie', cookie()).expect(204);
  const cleared = logout.headers['set-cookie'][0] as string;
  expect(cleared).toContain('__Host-lessonforge_session=;');
  expect(cleared).toContain('Secure');
  expect(cleared).toContain('HttpOnly');
  expect(cleared).toContain('SameSite=Lax');
  expect(cleared).toContain('01 Jan 1970');
  expect(cleared).not.toContain('Domain=');
});
it('rejects CSRF on public login/logout and refuses missing, null, suffix, or cross-site origins', async () => {
  for (const path of ['/auth/login', '/auth/logout']) {
    for (const origin of [
      undefined,
      'null',
      'http://localhost:3000.evil.test',
      'http://localhost:3000/',
    ]) {
      let req = request(app.getHttpServer())
        .post(path)
        .set('X-LessonForge-CSRF', '1')
        .send({});
      if (origin) req = req.set('Origin', origin);
      await req.expect(403);
    }
    await request(app.getHttpServer())
      .post(path)
      .set('Origin', config.allowedOrigins[0])
      .send({})
      .expect(403);
    await post(path).set('Sec-Fetch-Site', 'cross-site').expect(403);
  }
  expect(passwords.verify).not.toHaveBeenCalled();
  expect(repository.revoke).not.toHaveBeenCalled();
});
it('allows only exact credentialed preflights with explicit headers', async () => {
  const res = await request(app.getHttpServer())
    .options('/auth/login')
    .set('Origin', config.allowedOrigins[0])
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'Content-Type,X-LessonForge-CSRF')
    .expect(204);
  expect(res.headers['access-control-allow-origin']).toBe(
    config.allowedOrigins[0],
  );
  expect(res.headers['access-control-allow-credentials']).toBe('true');
  expect(res.headers['access-control-allow-headers']).toBe(
    'Content-Type,X-LessonForge-CSRF',
  );
  expect(res.headers.vary).toContain('Origin');
  expect(passwords.verify).not.toHaveBeenCalled();
  const denied = await request(app.getHttpServer())
    .options('/auth/login')
    .set('Origin', 'http://evil.test')
    .set('Access-Control-Request-Method', 'POST');
  expect(denied.headers['access-control-allow-origin']).toBeUndefined();
});
it('bounds parsing and rejects simple content, malformed JSON, oversized bodies, and unknown fields', async () => {
  await post('/auth/login').type('form').expect(415);
  await request(app.getHttpServer())
    .post('/auth/login')
    .set('Origin', config.allowedOrigins[0])
    .set('X-LessonForge-CSRF', '1')
    .type('json')
    .send('{')
    .expect(400);
  await post('/auth/login')
    .send({ extra: 'x'.repeat(5000) })
    .expect(413);
  await post('/auth/login').send({ role: 'ADMIN' }).expect(400);
  expect(passwords.verify).not.toHaveBeenCalled();
});
it('rejects duplicate and malformed/JSON cookies without database authentication', async () => {
  await request(app.getHttpServer())
    .get('/auth/me')
    .set('Cookie', `${cookie()}; ${cookie()}`)
    .expect(400);
  for (const value of [
    'invalid',
    `j:${encodeURIComponent('{}')}`,
    'A'.repeat(42),
    'A'.repeat(42) + 'B',
  ]) {
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `${config.cookieName}=${value}`)
      .expect(401);
  }
  expect(repository.authenticate).not.toHaveBeenCalled();
});
const cookieModes = [
  { mode: 'local', settings: resolveAuthConfig({}) },
  {
    mode: 'HTTPS',
    settings: resolveAuthConfig({
      AUTH_COOKIE_MODE: 'https',
      NODE_ENV: 'production',
      API_PUBLIC_ORIGIN: 'https://api.example.test',
      AUTH_ALLOWED_ORIGINS: 'https://ui.example.test',
    }),
  },
];
const duplicateCookies = cookieModes.flatMap((mode) =>
  [' ', '\t'].flatMap((padding) =>
    [1, 2, 3].flatMap((padded) =>
      [false, true].map((reversed) => ({
        ...mode,
        padding,
        whitespace: padding === ' ' ? 'space' : 'tab',
        padded,
        reversed,
      })),
    ),
  ),
);
it.each(duplicateCookies)(
  'rejects $mode duplicate cookies: $whitespace, padded mask $padded, reversed $reversed, before repository work',
  async ({ settings, padding, padded, reversed }) => {
    if (settings.cookieName !== config.cookieName) {
      await app.close();
      await open(settings);
    }
    const otherToken = newToken();
    const tokens = reversed ? [otherToken, token] : [token, otherToken];
    const header = tokens
      .map(
        (value, index) =>
          ` \t${config.cookieName}${padded & (1 << index) ? padding : ''}=${value}`,
      )
      .join(';');
    // configureAuthHttp installs the actual cookie-parser, not a parsed-cookie fake.
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', header)
      .expect(400);
    await post('/auth/login').set('Cookie', header).expect(400);
    await post('/auth/logout').set('Cookie', header).expect(400);
    expect(repository.authenticate).not.toHaveBeenCalled();
    expect(repository.findLoginUser).not.toHaveBeenCalled();
    expect(passwords.verify).not.toHaveBeenCalled();
    expect(repository.rotate).not.toHaveBeenCalled();
    expect(repository.revoke).not.toHaveBeenCalled();
  },
);
it.each(
  cookieModes.flatMap((mode) =>
    ['', ' ', '\t'].map((padding) => ({
      ...mode,
      padding,
      whitespace: padding === '' ? 'none' : padding === ' ' ? 'space' : 'tab',
    })),
  ),
)(
  'accepts a single $mode cookie with $whitespace before equals through the real parser',
  async ({ settings, padding }) => {
    if (settings.cookieName !== config.cookieName) {
      await app.close();
      await open(settings);
    }
    const header = ` \t${config.cookieName}${padding}=${token}`;
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', header)
      .expect(200);
    expect(repository.authenticate).toHaveBeenCalledWith(tokenHash(token));
    await post('/auth/login').set('Cookie', header).expect(200);
    expect(repository.rotate).toHaveBeenCalledWith(
      loginUser,
      expect.any(String),
      tokenHash(token),
    );
    await post('/auth/logout').set('Cookie', header).expect(204);
    expect(repository.revoke).toHaveBeenCalledWith(tokenHash(token));
  },
);
it('makes logout idempotent, revokes only the presented token, and does not clear on database failure', async () => {
  await post('/auth/logout').expect(204);
  expect(repository.revoke).not.toHaveBeenCalled();
  await post('/auth/logout').set('Cookie', cookie()).expect(204);
  expect(repository.revoke).toHaveBeenCalledWith(tokenHash(token));
  repository.revoke.mockRejectedValue(
    new Error('postgresql://secret:credential@private-host'),
  );
  const failure = await post('/auth/logout')
    .set('Cookie', cookie())
    .expect(503);
  expect(failure.headers['set-cookie']).toBeUndefined();
  expect(failure.text).not.toContain('credential');
  expect(failure.headers['retry-after']).toBe('1');
});
it('uses generic login failures and sanitizes infrastructure failures without setting a cookie', async () => {
  passwords.verify.mockResolvedValue(false);
  const incorrect = await post('/auth/login').expect(401);
  repository.findLoginUser.mockResolvedValue(null);
  const unknown = await post('/auth/login', 'unknown@example.test').expect(401);
  expect(incorrect.body).toEqual(unknown.body);
  expect(unknown.body.message).toBe('Invalid email or password.');
  expect(repository.rotate).not.toHaveBeenCalled();
  repository.findLoginUser.mockRejectedValue(
    new Error('private driver password'),
  );
  const unavailable = await post('/auth/login', 'third@example.test').expect(
    503,
  );
  expect(unavailable.headers['set-cookie']).toBeUndefined();
  expect(unavailable.text).not.toContain('password');
});
it('limits canonical email/IP attempts before KDF, counts successes, and ignores spoofed forwarded IPs', async () => {
  for (let i = 0; i < 5; i++)
    await post(
      '/auth/login',
      i % 2 ? 'Teacher@Example.test' : user.email,
    ).expect(200);
  const blocked = await post('/auth/login')
    .set('X-Forwarded-For', '198.51.100.8')
    .expect(429);
  expect(blocked.headers['retry-after']).toBeDefined();
  expect(passwords.verify).toHaveBeenCalledTimes(5);
});
it('applies the IP budget before adding email trackers', async () => {
  for (let i = 0; i < 20; i++)
    await post('/auth/login', `teacher${i}@example.test`).expect(200);
  await post('/auth/login', 'different@example.test').expect(429);
  expect(passwords.verify).toHaveBeenCalledTimes(20);
});
it('returns safe 503 on bounded tracker capacity without calling KDF', async () => {
  vi.spyOn(storage, 'increment').mockImplementation(() => {
    throw new Error('private capacity diagnostic');
  });
  const res = await post('/auth/login').expect(503);
  expect(res.headers['retry-after']).toBe('1');
  expect(passwords.verify).not.toHaveBeenCalled();
  expect(res.text).not.toContain('private');
});
it('returns 401 for revoked/expired sessions without trusting request-supplied roles', async () => {
  repository.authenticate.mockResolvedValue(null);
  await request(app.getHttpServer())
    .get('/protected/admin')
    .set('Cookie', cookie())
    .set('Authorization', 'Bearer ADMIN')
    .expect(401);
});

it('shares the 120/IP budget across me and public logout, including failures', async () => {
  for (let i = 0; i < 120; i++) {
    if (i % 2) await post('/auth/logout').expect(204);
    else await request(app.getHttpServer()).get('/auth/me').expect(401);
  }
  await post('/auth/logout').expect(429);
}, 15000);
