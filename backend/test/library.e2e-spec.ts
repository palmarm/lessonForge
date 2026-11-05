import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { AuthConfig, resolveAuthConfig } from '../src/auth/auth.config.js';
import { configureAuthHttp } from '../src/auth/auth.http.js';
import { newToken } from '../src/auth/auth.cookies.js';
import { LibraryService } from '../src/lessons/library.service.js';
import {
  teacher,
  lessonId,
  resourceId,
  stamp,
} from './support/lesson-fixture.js';

let app: NestExpressApplication;
const config = resolveAuthConfig({});
const cookie = `${config.cookieName}=${newToken()}`;
const authenticate = vi.fn();
const library = {
  list: vi.fn(),
  detail: vi.fn(),
  copy: vi.fn(),
  recover: vi.fn(),
};
const key = '44444444-4444-4444-8444-444444444444';
const detail = `/library/approved/${lessonId}/revisions/${resourceId}`;
const copy = `/lessons/${lessonId}/revisions/${resourceId}/copy`;
const recovery = `/library/copy-operations/${key}`;
const body = { operationKey: key, expectedVersion: 3 };
const result = {
  operation: {
    key,
    source: { lessonId, revisionId: resourceId, expectedVersion: 3 },
    destinationLessonId: key,
  },
};
function identity(role: 'TEACHER' | 'ADMIN' = 'TEACHER') {
  authenticate.mockResolvedValue({
    user: { ...teacher, role },
    expiresAt: stamp,
  });
}
function get(path: string) {
  return request(app.getHttpServer()).get(path).set('Cookie', cookie);
}
function post(path: string, input: object) {
  return request(app.getHttpServer())
    .post(path)
    .set('Cookie', cookie)
    .set('Origin', config.allowedOrigins[0])
    .set('X-LessonForge-CSRF', '1')
    .send(input);
}
beforeEach(async () => {
  vi.resetAllMocks();
  identity();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({ client: {} })
    .overrideProvider(AuthConfig)
    .useValue(config)
    .overrideProvider(AuthRepository)
    .useValue({ authenticate })
    .overrideProvider(LibraryService)
    .useValue(library)
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

it('authenticates every browse, create, replay and recovery; only teachers copy or recover', async () => {
  authenticate.mockResolvedValue(null);
  for (const path of ['/library/approved', detail, recovery])
    await get(path).expect(401);
  await post(copy, body).expect(401);
  identity('ADMIN');
  await post(copy, {}).expect(403);
  await get(recovery).expect(403);
  for (const fn of Object.values(library)) expect(fn).not.toHaveBeenCalled();
  library.list.mockResolvedValue({ items: [], nextAfter: null });
  library.detail.mockResolvedValue({
    workflow: {},
    revision: {},
    approvedAt: stamp,
  });
  await get('/library/approved').expect(200);
  await get(detail).expect(200);
});

it('returns 201 on first creation, 200 on replay and exact mapping on recovery without draft content', async () => {
  library.copy
    .mockResolvedValueOnce({ created: true, result })
    .mockResolvedValueOnce({ created: false, result });
  for (const status of [201, 200]) {
    const response = await post(copy, body).expect(status);
    expect(response.body).toEqual(result);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(library.copy).toHaveBeenLastCalledWith(
      teacher,
      lessonId,
      resourceId,
      body,
    );
  }
  library.recover.mockResolvedValue(result);
  expect((await get(recovery).expect(200)).body).toEqual(result);
  expect(library.recover).toHaveBeenCalledWith(teacher, key);
});

it('uses existing bounded exclusive UUID pagination and rejects malformed requests', async () => {
  library.list.mockResolvedValue({ items: [], nextAfter: null });
  await get('/library/approved').expect(200);
  expect(library.list).toHaveBeenLastCalledWith(teacher, 20, undefined);
  await get(`/library/approved?limit=50&after=${resourceId}`).expect(200);
  expect(library.list).toHaveBeenLastCalledWith(teacher, 50, resourceId);
  for (const query of [
    'limit=51',
    'limit=0',
    'limit=1&limit=2',
    'after=bad',
    `after=${resourceId}&after=${resourceId}`,
    'ownerId=x',
  ])
    await get(`/library/approved?${query}`).expect(400);
  for (const input of [
    {},
    { ...body, operationKey: 'bad' },
    { ...body, expectedVersion: '3' },
    { ...body, expectedVersion: 0 },
    ...[
      'ownerId',
      'content',
      'sources',
      'generationOrigin',
      'copiedFromRevisionId',
      'review',
    ].map((field) => ({ ...body, [field]: {} })),
  ])
    await post(copy, input).expect(400);
  await get('/library/copy-operations/bad').expect(400);
  await get('/library/approved/bad/revisions/bad').expect(400);
  await post('/lessons/bad/revisions/bad/copy', body).expect(400);
});

it('retains Origin, CSRF, JSON, body budgets, CORS and no-store headers', async () => {
  await request(app.getHttpServer()).post(copy).send(body).expect(403);
  await request(app.getHttpServer())
    .post(copy)
    .set('Origin', config.allowedOrigins[0])
    .set('X-LessonForge-CSRF', '1')
    .set('Content-Type', 'text/plain')
    .send('x')
    .expect(415);
  await post(copy, { ...body, extra: 'x'.repeat(140000) }).expect(413);
  await post('/auth/login', { email: 'x'.repeat(5000) }).expect(413);
  const response = await request(app.getHttpServer())
    .options(copy)
    .set('Origin', config.allowedOrigins[0])
    .set('Access-Control-Request-Method', 'POST')
    .expect(204);
  expect(response.headers['access-control-allow-credentials']).toBe('true');
});

it('shares the lesson rate budget between library reads, copy and recovery', async () => {
  library.list.mockResolvedValue({ items: [], nextAfter: null });
  for (let index = 0; index < 120; index++)
    await get('/library/approved').expect(200);
  await post(copy, body).expect(429);
  await get(recovery).expect(429);
  expect(library.copy).not.toHaveBeenCalled();
  expect(library.recover).not.toHaveBeenCalled();
});

it('sanitizes unavailable, mismatched-key and infrastructure errors without revealing mappings', async () => {
  for (const [error, status] of [
    [new NotFoundException('private source'), 404],
    [new ConflictException('private key mapping'), 409],
    [new Error('private database'), 503],
  ] as const) {
    library.copy.mockRejectedValueOnce(error);
    const response = await post(copy, body).expect(status);
    expect(Object.keys(response.body).sort()).toEqual([
      'message',
      'statusCode',
    ]);
    expect(response.text).not.toContain('private');
    expect(response.headers['cache-control']).toBe('no-store');
  }
  library.recover.mockRejectedValueOnce(
    new NotFoundException('foreign mapping'),
  );
  expect((await get(recovery).expect(404)).body).toEqual({
    statusCode: 404,
    message: 'Not found.',
  });
});
