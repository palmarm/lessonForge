import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { AuthConfig, resolveAuthConfig } from '../src/auth/auth.config.js';
import { configureAuthHttp } from '../src/auth/auth.http.js';
import { newToken } from '../src/auth/auth.cookies.js';
import {
  lessonFixture,
  teacher,
  lessonId,
  resourceId,
  stamp,
} from './support/lesson-fixture.js';
let app: NestExpressApplication;
let f: ReturnType<typeof lessonFixture>;
const config = resolveAuthConfig({});
const authenticate = vi.fn();
const cookie = `${config.cookieName}=${newToken()}`;
function identity(role: 'ADMIN' | 'TEACHER' = 'TEACHER', id = teacher.id) {
  authenticate.mockResolvedValue({
    user: { id, role, email: 'teacher@example.test', displayName: 'Fixture' },
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
  f = lessonFixture();
  identity();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({ client: f.db })
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
it('requires authentication and rejects administrators on every draft endpoint', async () => {
  await request(app.getHttpServer()).get('/lessons').expect(401);
  identity('ADMIN');
  for (const path of ['/lessons', `/lessons/${lessonId}`])
    await request(app.getHttpServer())
      .get(path)
      .set('Cookie', cookie)
      .expect(403);
  for (const [method, path] of [
    ['post', '/lessons'],
    ['put', `/lessons/${lessonId}`],
    ...['select', 'remove', 'refresh'].map((a) => [
      'post',
      `/lessons/${lessonId}/resources/${resourceId}/${a}`,
    ]),
  ] as ['post' | 'put', string][])
    await write(method, path, {}).expect(403);
  expect(f.db.lesson.create).not.toHaveBeenCalled();
  expect(f.db.$transaction).not.toHaveBeenCalled();
});
it('creates incomplete drafts, lists summaries, saves, and selects/removes trusted resource snapshots', async () => {
  const created = await write('post', '/lessons', {
    content: { title: '<script>text</script>' },
  }).expect(201);
  expect(created.body.content.title).toBe('<script>text</script>');
  expect(created.headers['cache-control']).toBe('no-store');
  const list = await request(app.getHttpServer())
    .get('/lessons')
    .set('Cookie', cookie)
    .expect(200);
  expect(list.body.items[0].sources).toBeUndefined();
  expect(list.body.items[0].content).toBeUndefined();
  await request(app.getHttpServer())
    .get(`/lessons/${lessonId}`)
    .set('Cookie', cookie)
    .expect(200);
  const selected = await write(
    'post',
    `/lessons/${lessonId}/resources/${resourceId}/select`,
    { expectedVersion: 1 },
  ).expect(200);
  expect(selected.body.sources[0].snapshot.contentText).toBe(
    '<script>one half</script>',
  );
  const saved = await write('put', `/lessons/${lessonId}`, {
    expectedVersion: 2,
    content: {},
  }).expect(200);
  expect(saved.body.sources).toEqual(selected.body.sources);
  await write('post', `/lessons/${lessonId}/resources/${resourceId}/refresh`, {
    expectedVersion: 3,
  }).expect(200);
  await write('post', `/lessons/${lessonId}/resources/${resourceId}/remove`, {
    expectedVersion: 4,
  }).expect(200);
});
it('does not expose content in foreign or stale responses and sanitizes availability failures', async () => {
  identity('TEACHER', resourceId);
  await request(app.getHttpServer())
    .get(`/lessons/${lessonId}`)
    .set('Cookie', cookie)
    .expect(404);
  await write('put', `/lessons/${lessonId}`, {
    expectedVersion: 999,
    content: {},
  }).expect(404);
  identity();
  const conflict = await write('put', `/lessons/${lessonId}`, {
    expectedVersion: 999,
    content: {},
  }).expect(409);
  expect(Object.keys(conflict.body).sort()).toEqual(['message', 'statusCode']);
  f.db.$transaction.mockRejectedValueOnce(new Error('private database detail'));
  const unavailable = await write('put', `/lessons/${lessonId}`, {
    expectedVersion: 1,
    content: {},
  }).expect(503);
  expect(unavailable.text).not.toContain('private');
});
it('rejects forged metadata, malformed queries/ids, unknown nested fields and source bodies', async () => {
  for (const body of [
    { content: {}, ownerId: teacher.id },
    { content: { sources: [] } },
    { content: { activities: [{ snapshot: {} }] } },
  ])
    await write('post', '/lessons', body).expect(400);
  for (const path of [
    '/lessons?limit=51',
    '/lessons?limit=1&limit=2',
    '/lessons?ownerId=x',
    '/lessons/bad',
  ])
    await request(app.getHttpServer())
      .get(path)
      .set('Cookie', cookie)
      .expect(400);
  for (const action of ['select', 'refresh', 'remove'])
    await write(
      'post',
      `/lessons/${lessonId}/resources/${resourceId}/${action}`,
      { expectedVersion: 1, snapshot: {} },
    ).expect(400);
});
it('retains credentialed CORS, CSRF, parser limits, and the small auth body budget', async () => {
  await request(app.getHttpServer())
    .post('/lessons')
    .set('Cookie', cookie)
    .send({ content: {} })
    .expect(403);
  const preflight = await request(app.getHttpServer())
    .options('/lessons')
    .set('Origin', config.allowedOrigins[0])
    .set('Access-Control-Request-Method', 'PUT')
    .expect(204);
  expect(preflight.headers['access-control-allow-credentials']).toBe('true');
  await write('post', '/lessons', {
    content: {
      introduction: { text: 'x'.repeat(4000) },
      assessment: { text: 'x'.repeat(4000) },
    },
  }).expect(201);
  await write('post', '/lessons', {
    content: { title: 'x'.repeat(140000) },
  }).expect(413);
  await write('post', '/auth/login', { email: 'x'.repeat(5000) }).expect(413);
});
