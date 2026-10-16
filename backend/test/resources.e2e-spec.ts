import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { AuthConfig, resolveAuthConfig } from '../src/auth/auth.config.js';
import { configureAuthHttp } from '../src/auth/auth.http.js';
import { newToken } from '../src/auth/auth.cookies.js';
import { BoundedThrottleStorage } from '../src/auth/auth.rate-limit.js';

const id = '11111111-1111-4111-8111-111111111111';
const content = {
  title: 'Equal parts',
  subject: 'Mathematics',
  grade: 'Grade 4',
  sourceReference: 'Original demonstration https://never-fetch.invalid',
  contentText: '<script>plain text</script>',
};
const stamp = new Date('2030-01-01T00:00:00Z');
const row = {
  id,
  ...content,
  version: 1,
  retiredAt: null as Date | null,
  createdAt: stamp,
  updatedAt: stamp,
};
const config = resolveAuthConfig({});
const cookie = `${config.cookieName}=${newToken()}`;
const authenticate = vi.fn();
let app: NestExpressApplication;
let current: typeof row;
const resource = {
  findMany: vi.fn(),
  findFirst: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
};
const tx = { curriculumResource: resource, $queryRaw: vi.fn() };
const transaction = vi.fn(async (run: (value: typeof tx) => unknown) =>
  run(tx),
);
function role(value: 'ADMIN' | 'TEACHER') {
  authenticate.mockResolvedValue({
    user: {
      id,
      role: value,
      email: 'fixture@example.test',
      displayName: 'Fixture',
    },
    expiresAt: stamp,
  });
}
function write(method: 'post' | 'put', path: string, body: object) {
  return request(app.getHttpServer())
    [method](path)
    .set('Cookie', cookie)
    .set('Origin', config.allowedOrigins[0])
    .set('X-LessonForge-CSRF', '1')
    .send(body);
}
beforeEach(async () => {
  vi.resetAllMocks();
  current = { ...row };
  role('ADMIN');
  resource.findMany.mockImplementation(
    (args: { where: { retiredAt?: null }; select: Record<string, boolean> }) =>
      Promise.resolve(
        current.retiredAt && args.where.retiredAt === null
          ? []
          : [
              Object.fromEntries(
                Object.keys(args.select).map((k) => [
                  k,
                  current[k as keyof typeof row],
                ]),
              ),
            ],
      ),
  );
  resource.findFirst.mockImplementation(
    (args: { where: { retiredAt?: null } }) =>
      Promise.resolve(
        current.retiredAt && args.where.retiredAt === null ? null : current,
      ),
  );
  resource.findUniqueOrThrow.mockImplementation(() => Promise.resolve(current));
  resource.create.mockResolvedValue(current);
  resource.update.mockImplementation((args: { data: object }) => {
    current = { ...current, ...args.data, version: current.version + 1 };
    return Promise.resolve(current);
  });
  tx.$queryRaw.mockResolvedValue([{ id }]);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({
      client: { curriculumResource: resource, $transaction: transaction },
    })
    .overrideProvider(AuthConfig)
    .useValue(config)
    .overrideProvider(AuthRepository)
    .useValue({ authenticate })
    .compile();
  app = module.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  configureAuthHttp(app, config);
  await app.init();
});
afterEach(async () => {
  await app.close();
});
it('requires authentication and blocks teacher mutations before validation, without exposing resources', async () => {
  await request(app.getHttpServer()).get('/resources').expect(401);
  role('TEACHER');
  for (const [method, path] of [
    ['post', '/resources'],
    ['put', `/resources/${id}`],
    ['post', `/resources/${id}/retire`],
  ] as const) {
    const res = await write(method, path, {
      expectedVersion: 999,
      version: 2,
    }).expect(403);
    expect(res.body).toEqual({ statusCode: 403, message: 'Forbidden.' });
  }
  expect(resource.create).not.toHaveBeenCalled();
  expect(transaction).not.toHaveBeenCalled();
});
it('returns bounded summaries and text details; hides retired records only from teachers', async () => {
  role('TEACHER');
  const list = await request(app.getHttpServer())
    .get('/resources')
    .set('Cookie', cookie)
    .expect(200);
  expect(list.body.items[0].contentText).toBeUndefined();
  expect(list.body.nextAfter).toBeNull();
  expect(list.headers['cache-control']).toBe('no-store');
  const detail = await request(app.getHttpServer())
    .get(`/resources/${id}`)
    .set('Cookie', cookie)
    .expect(200);
  expect(detail.body.contentText).toBe(content.contentText);
  current.retiredAt = stamp;
  expect(
    (
      await request(app.getHttpServer())
        .get('/resources')
        .set('Cookie', cookie)
        .expect(200)
    ).body.items,
  ).toEqual([]);
  await request(app.getHttpServer())
    .get(`/resources/${id}`)
    .set('Cookie', cookie)
    .expect(404);
  role('ADMIN');
  expect(
    (
      await request(app.getHttpServer())
        .get('/resources')
        .set('Cookie', cookie)
        .expect(200)
    ).body.items,
  ).toHaveLength(1);
  expect(
    (
      await request(app.getHttpServer())
        .get(`/resources/${id}`)
        .set('Cookie', cookie)
        .expect(200)
    ).body.retiredAt,
  ).toBe(stamp.toISOString());
});
it('validates exact bodies/query/id/context/version and retains separate authentication parsing limits', async () => {
  for (const path of [
    '/resources?limit=51',
    '/resources?limit=1&limit=2',
    '/resources?after=bad',
    '/resources?extra=x',
    '/resources/not-a-uuid',
  ])
    await request(app.getHttpServer())
      .get(path)
      .set('Cookie', cookie)
      .expect(400);
  for (const body of [
    { ...content, id },
    { ...content, retiredAt: null },
    { ...content, version: 1 },
    { ...content, grade: 'Grade 5' },
    { ...content, contentText: ' ' },
    { ...content, contentText: 'x'.repeat(20001) },
  ])
    await write('post', '/resources', body).expect(400);
  await write('put', `/resources/${id}`, content).expect(400);
  await write('post', `/resources/${id}/retire`, {
    expectedVersion: 1,
    title: 'x',
  }).expect(400);
  await write('post', '/resources', {
    ...content,
    contentText: 'x'.repeat(5000),
  }).expect(201);
  await write('post', '/auth/login', {
    email: 'a@example.test',
    password: 'x'.repeat(5000),
  }).expect(413);
  await write('post', '/resources', {
    ...content,
    contentText: 'x'.repeat(140000),
  }).expect(413);
  await request(app.getHttpServer())
    .post('/resources')
    .set('Origin', config.allowedOrigins[0])
    .set('X-LessonForge-CSRF', '1')
    .type('json')
    .send('{')
    .expect(400);
});
it('preserves CSRF/origin/content-type enforcement and credentialed preflights on resource endpoints', async () => {
  for (const [method, path, body] of [
    ['post', '/resources', content],
    ['put', `/resources/${id}`, { ...content, expectedVersion: 1 }],
    ['post', `/resources/${id}/retire`, { expectedVersion: 1 }],
  ] as const) {
    await request(app.getHttpServer())
      [method](path)
      .set('Cookie', cookie)
      .set('Origin', config.allowedOrigins[0])
      .send(body)
      .expect(403);
    await write(method, path, body)
      .set('Origin', 'https://evil.test')
      .expect(403);
    await write(method, path, body)
      .set('Sec-Fetch-Site', 'cross-site')
      .expect(403);
    await write(method, path, body).type('form').expect(415);
  }
  const res = await request(app.getHttpServer())
    .options(`/resources/${id}`)
    .set('Origin', config.allowedOrigins[0])
    .set('Access-Control-Request-Method', 'PUT')
    .set('Access-Control-Request-Headers', 'Content-Type,X-LessonForge-CSRF')
    .expect(204);
  expect(res.headers['access-control-allow-origin']).toBe(
    config.allowedOrigins[0],
  );
  expect(res.headers['access-control-allow-credentials']).toBe('true');
  expect(resource.create).not.toHaveBeenCalled();
});
it('returns committed versions and safe 409s for stale/retired changes; repeats retirement without a write', async () => {
  expect(
    (await write('post', '/resources', content).expect(201)).body.version,
  ).toBe(1);
  expect(
    (
      await write('put', `/resources/${id}`, {
        ...content,
        title: 'Changed',
        expectedVersion: 1,
      }).expect(200)
    ).body.version,
  ).toBe(2);
  const conflict = await write('put', `/resources/${id}`, {
    ...content,
    expectedVersion: 1,
  }).expect(409);
  expect(Object.keys(conflict.body).sort()).toEqual(['message', 'statusCode']);
  expect(
    (
      await write('post', `/resources/${id}/retire`, {
        expectedVersion: 2,
      }).expect(200)
    ).body.version,
  ).toBe(3);
  await write('post', `/resources/${id}/retire`, { expectedVersion: 2 }).expect(
    409,
  );
  const repeated = await write('post', `/resources/${id}/retire`, {
    expectedVersion: 3,
  }).expect(200);
  expect(repeated.body.version).toBe(3);
  await write('put', `/resources/${id}`, {
    ...content,
    expectedVersion: 3,
  }).expect(409);
  expect(resource.update).toHaveBeenCalledTimes(2);
  tx.$queryRaw.mockResolvedValue([]);
  await write('post', `/resources/${id}/retire`, { expectedVersion: 1 }).expect(
    404,
  );
});
it('sanitizes database failures and preserves no-store and retry hints', async () => {
  resource.findMany.mockRejectedValue(new Error('private database password'));
  const res = await request(app.getHttpServer())
    .get('/resources')
    .set('Cookie', cookie)
    .expect(503);
  expect(res.body).toEqual({
    statusCode: 503,
    message: 'Service unavailable.',
  });
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.headers['retry-after']).toBe('1');
  resource.update.mockRejectedValue(
    new Error('private content database error'),
  );
  const failure = await write('put', `/resources/${id}`, {
    ...content,
    expectedVersion: 1,
  }).expect(503);
  expect(failure.text).not.toContain('private');
});
it('shares a bounded IP budget across resource reads and writes, without trusting forwarded IPs', async () => {
  for (let i = 0; i < 120; i++)
    await request(app.getHttpServer())
      .get(i % 2 ? `/resources/${id}` : '/resources')
      .set('Cookie', cookie)
      .expect(200);
  const blocked = await write('post', '/resources', content)
    .set('X-Forwarded-For', '198.51.100.5')
    .expect(429);
  expect(blocked.headers['retry-after']).toBeDefined();
  expect(resource.create).not.toHaveBeenCalled();
}, 15000);
it('sanitizes capacity exhaustion before querying resources', async () => {
  const storage = app.get(BoundedThrottleStorage);
  vi.spyOn(storage, 'increment').mockRejectedValue(
    new Error('private tracker diagnostic'),
  );
  await request(app.getHttpServer())
    .get('/resources')
    .set('Cookie', cookie)
    .expect(503, { statusCode: 503, message: 'Service unavailable.' });
  expect(resource.findMany).not.toHaveBeenCalled();
});
