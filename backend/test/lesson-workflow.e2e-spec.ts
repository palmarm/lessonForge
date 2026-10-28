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
import { LessonWorkflowService } from '../src/lessons/lesson-workflow.service.js';
import {
  lessonId,
  resourceId,
  teacher,
  stamp,
} from './support/lesson-fixture.js';

let app: NestExpressApplication;
const config = resolveAuthConfig({});
const cookie = `${config.cookieName}=${newToken()}`;
const authenticate = vi.fn();
const workflow = {
  submit: vi.fn(),
  review: vi.fn(),
  history: vi.fn(),
  detail: vi.fn(),
  pending: vi.fn(),
};
const submission = `/lessons/${lessonId}/submit`;
const history = `/lessons/${lessonId}/revisions`;
const detail = `${history}/${resourceId}`;
const review = `${detail}/review`;
function identity(role: 'TEACHER' | 'ADMIN' = 'TEACHER') {
  authenticate.mockResolvedValue({
    user: { ...teacher, role },
    expiresAt: stamp,
  });
}
function get(path: string) {
  return request(app.getHttpServer()).get(path).set('Cookie', cookie);
}
function post(path: string, body: object) {
  return request(app.getHttpServer())
    .post(path)
    .set('Cookie', cookie)
    .set('Origin', config.allowedOrigins[0])
    .set('X-LessonForge-CSRF', '1')
    .send(body);
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
    .overrideProvider(LessonWorkflowService)
    .useValue(workflow)
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

it('requires sessions on every workflow route and enforces roles before body/version checks', async () => {
  authenticate.mockResolvedValue(null);
  for (const path of [history, detail, '/reviews/pending'])
    await get(path).expect(401);
  for (const path of [submission, review]) await post(path, {}).expect(401);
  identity('ADMIN');
  await post(submission, {}).expect(403);
  identity();
  await post(review, {}).expect(403);
  await get('/reviews/pending').expect(403);
  for (const fn of Object.values(workflow)) expect(fn).not.toHaveBeenCalled();
});
it('returns 201 envelopes and passes server actor and exact identifiers/preconditions', async () => {
  const envelope = {
    workflow: {
      lessonId,
      version: 2,
      state: 'SUBMITTED',
      currentRevisionId: resourceId,
    },
    revision: { id: resourceId },
  };
  workflow.submit.mockResolvedValue(envelope);
  const response = await post(submission, { expectedVersion: 1 }).expect(201);
  expect(response.body).toEqual(envelope);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(workflow.submit).toHaveBeenCalledWith(teacher, lessonId, 1);
  identity('ADMIN');
  workflow.review.mockResolvedValue(envelope);
  await post(review, {
    expectedVersion: 2,
    decision: 'REQUEST_CHANGES',
    feedback: ' Please explain ',
  }).expect(201);
  expect(workflow.review).toHaveBeenCalledWith(
    { ...teacher, role: 'ADMIN' },
    lessonId,
    resourceId,
    {
      expectedVersion: 2,
      decision: 'REQUEST_CHANGES',
      feedback: 'Please explain',
    },
  );
});
it('parses bounded exclusive UUID pagination on history and queue', async () => {
  workflow.history.mockResolvedValue({
    workflow: {},
    items: [],
    nextAfter: null,
  });
  workflow.detail.mockResolvedValue({ workflow: {}, revision: {} });
  workflow.pending.mockResolvedValue({ items: [], nextAfter: null });
  await get(history).expect(200);
  expect(workflow.history).toHaveBeenLastCalledWith(
    teacher,
    lessonId,
    20,
    undefined,
  );
  await get(`${history}?limit=50&after=${resourceId}`).expect(200);
  expect(workflow.history).toHaveBeenLastCalledWith(
    teacher,
    lessonId,
    50,
    resourceId,
  );
  await get(detail).expect(200);
  identity('ADMIN');
  await get('/reviews/pending?limit=1').expect(200);
  expect(workflow.pending).toHaveBeenCalledWith(
    { ...teacher, role: 'ADMIN' },
    1,
    undefined,
  );
  for (const path of [history, '/reviews/pending']) {
    for (const query of [
      'limit=51',
      'limit=1&limit=2',
      'after=bad',
      'ownerId=x',
    ])
      await get(`${path}?${query}`).expect(400);
  }
});
it('rejects metadata/content injection, malformed IDs, feedback and versions', async () => {
  for (const body of [
    {},
    { expectedVersion: 0 },
    { expectedVersion: '1' },
    { expectedVersion: 1, content: {} },
    { expectedVersion: 1, sources: [] },
  ])
    await post(submission, body).expect(400);
  await post('/lessons/bad/submit', { expectedVersion: 1 }).expect(400);
  identity('ADMIN');
  for (const body of [
    { expectedVersion: 1, decision: 'REQUEST_CHANGES', feedback: ' ' },
    { expectedVersion: 1, decision: 'APPROVE', feedback: 'x'.repeat(4001) },
    { expectedVersion: 1, decision: 'REJECT' },
    { expectedVersion: 1, decision: 'APPROVE', reviewerId: teacher.id },
  ])
    await post(review, body).expect(400);
});
it('retains JSON/CSRF/CORS and lesson body budgets without enlarging authentication', async () => {
  await request(app.getHttpServer())
    .post(submission)
    .send({ expectedVersion: 1 })
    .expect(403);
  await request(app.getHttpServer())
    .post(review)
    .set('Origin', config.allowedOrigins[0])
    .set('X-LessonForge-CSRF', '1')
    .set('Content-Type', 'text/plain')
    .send('x')
    .expect(415);
  identity('ADMIN');
  workflow.review.mockResolvedValue({ workflow: {}, revision: {} });
  await post(review, {
    expectedVersion: 1,
    decision: 'APPROVE',
    feedback: '😀'.repeat(2000),
  }).expect(201);
  await post(review, {
    expectedVersion: 1,
    decision: 'APPROVE',
    feedback: 'x'.repeat(140000),
  }).expect(413);
  await post(submission, {
    expectedVersion: 1,
    extra: 'x'.repeat(140000),
  }).expect(413);
  await post('/auth/login', { email: 'x'.repeat(5000) }).expect(413);
  const preflight = await request(app.getHttpServer())
    .options(review)
    .set('Origin', config.allowedOrigins[0])
    .set('Access-Control-Request-Method', 'POST')
    .expect(204);
  expect(preflight.headers['access-control-allow-credentials']).toBe('true');
});
it('exposes only safe errors on access denial, conflicts and infrastructure failures', async () => {
  for (const [error, status] of [
    [new NotFoundException(), 404],
    [new ConflictException('private version'), 409],
    [new Error('private database'), 503],
  ] as const) {
    workflow.submit.mockRejectedValueOnce(error);
    const response = await post(submission, { expectedVersion: 1 }).expect(
      status,
    );
    expect(Object.keys(response.body).sort()).toEqual([
      'message',
      'statusCode',
    ]);
    expect(response.text).not.toContain('private');
  }
});

it('sanitizes review target failures and conflicts without disclosing target or lesson data', async () => {
  identity('ADMIN');
  for (const [error, status, message] of [
    [new NotFoundException('private target membership'), 404, 'Not found.'],
    [
      new ConflictException('private lesson version'),
      409,
      'Version or state conflict. Reload before trying again.',
    ],
    [new Error('private query detail'), 503, 'Service unavailable.'],
  ] as const) {
    workflow.review.mockRejectedValueOnce(error);
    const response = await post(review, {
      expectedVersion: 1,
      decision: 'APPROVE',
    }).expect(status);
    expect(response.body).toEqual({ statusCode: status, message });
    expect(response.headers['cache-control']).toBe('no-store');
  }
});
