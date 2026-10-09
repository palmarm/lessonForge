import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Test } from '@nestjs/testing';
import { Controller, Get, Module } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import {
  createDatabaseClient,
  PrismaService,
} from '../src/prisma/prisma.service.js';
import { AppModule } from '../src/app.module.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { AuthService, LoginFailure } from '../src/auth/auth.service.js';
import { AuthConfig, resolveAuthConfig } from '../src/auth/auth.config.js';
import { configureAuthHttp } from '../src/auth/auth.http.js';
import { PasswordService } from '../src/auth/password.service.js';
import { Roles } from '../src/auth/auth.guards.js';
import { newToken, tokenHash } from '../src/auth/auth.cookies.js';
import { initializeConstraintDatabase } from './support/constraint-preflight.js';
import { resolveConstraintDatabaseUrl } from './support/constraint-database.js';

@Controller('live-role')
class LiveRoleController {
  @Get() @Roles('ADMIN') admin() {
    return 'admin';
  }
}
@Module({ imports: [AppModule], controllers: [LiveRoleController] })
class LiveHttpModule {}

let db: PrismaClient;
let independent: PrismaClient;
let repository: AuthRepository;
let service: AuthService;
let passwords: PasswordService;
let url: string;
let teacher: Awaited<ReturnType<AuthRepository['findLoginUser']>>;
let app: NestExpressApplication;
const config = resolveAuthConfig({});
const password = ' Isolated Unicode 🔒 password ';
let domainBefore: unknown;

beforeAll(async () => {
  // Reject development/non-disposable targets before constructing either client.
  url = resolveConstraintDatabaseUrl(
    process.env.CONSTRAINT_TEST_DATABASE_URL,
    process.env.LESSONFORGE_CONSTRAINT_TEST,
  );
  db = createDatabaseClient(url);
  await initializeConstraintDatabase(db, async () => {
    try {
      await promisify(execFile)(
        process.execPath,
        [
          fileURLToPath(
            new URL('../node_modules/prisma/build/index.js', import.meta.url),
          ),
          'migrate',
          'deploy',
          '--config',
          'prisma.constraints.config.ts',
        ],
        {
          cwd: fileURLToPath(new URL('../', import.meta.url)),
          env: { ...process.env, DATABASE_URL: undefined },
          timeout: 45000,
        },
      );
    } catch {
      throw new Error('Authentication disposable migration deployment failed.');
    }
  });
  independent = createDatabaseClient(url);
  passwords = new PasswordService();
  await passwords.onModuleInit();
  const hash = await passwords.hash(password);
  const account = await db.user.create({
    data: {
      email: 'auth-teacher@example.test',
      displayName: 'Teacher fixture',
      role: 'TEACHER',
      passwordHash: hash,
    },
  });
  const admin = await db.user.create({
    data: {
      email: 'auth-admin@example.test',
      displayName: 'Admin fixture',
      role: 'ADMIN',
      passwordHash: hash,
    },
  });
  repository = new AuthRepository(db);
  service = new AuthService(repository, passwords);
  teacher = await repository.findLoginUser(account.email);
  // Keep immutable domain history present so cleanup cannot pass by testing an empty domain.
  const resource = await db.curriculumResource.create({
    data: {
      title: 'Fraction fixture',
      subject: 'Mathematics',
      grade: 'Grade 4',
      sourceReference: 'Original demonstration',
      contentText: 'One half.',
    },
  });
  const lesson = await db.lesson.create({ data: { ownerId: account.id } });
  const revision = await db.lessonRevision.create({
    data: {
      lessonId: lesson.id,
      number: 1,
      content: {},
      generationOrigin: 'MANUAL',
    },
  });
  await db.revisionSource.create({
    data: {
      revisionId: revision.id,
      resourceId: resource.id,
      resourceVersion: 1,
      snapshot: {},
    },
  });
  await db.review.create({
    data: {
      revisionId: revision.id,
      reviewerId: admin.id,
      decision: 'APPROVE',
    },
  });
  domainBefore = await domainSnapshot();
  const fixture = await Test.createTestingModule({ imports: [LiveHttpModule] })
    .overrideProvider(PrismaService)
    .useValue({ client: db })
    .overrideProvider(AuthConfig)
    .useValue(config)
    .overrideProvider(PasswordService)
    .useValue(passwords)
    .compile();
  app = fixture.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  configureAuthHttp(app, config);
  await app.init();
});
afterAll(async () => {
  await app?.close();
  await passwords?.onModuleDestroy();
  await Promise.all([db?.$disconnect(), independent?.$disconnect()]);
});

async function domainSnapshot() {
  const rows: unknown[] = [];
  for (const table of [
    'User',
    'CurriculumResource',
    'Lesson',
    'LessonRevision',
    'Review',
    'RevisionSource',
  ])
    rows.push(
      await db.$queryRawUnsafe(
        `SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
      ),
    );
  return rows;
}
async function session(expires = '8 hours', lastSeen = '0 seconds') {
  const token = newToken();
  const id = randomUUID();
  await db.$executeRaw`
    INSERT INTO "Session" (id, "userId", "tokenHash", "createdAt", "lastSeenAt", "expiresAt")
    VALUES (${id}::uuid, ${teacher!.id}::uuid, ${tokenHash(token)}, clock_timestamp() - interval '2 hours', clock_timestamp() + ${lastSeen}::interval, clock_timestamp() + ${expires}::interval)
  `;
  return { id, token, hash: tokenHash(token) };
}
async function snapshot(id: string) {
  const [row] = await db.$queryRaw<
    { created: string; seen: string; expires: string; revoked: string | null }[]
  >`SELECT "createdAt"::text AS created, "lastSeenAt"::text AS seen, "expiresAt"::text AS expires, "revokedAt"::text AS revoked FROM "Session" WHERE id = ${id}::uuid`;
  return row;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function until(check: () => Promise<boolean>, label: string) {
  const deadline = performance.now() + 2500;
  while (!(await check())) {
    if (performance.now() > deadline)
      throw new Error(`Live synchronization failed: ${label}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}
async function blockedBy(pid: number, queryFragment = '') {
  await until(async () => {
    const [row] = await db.$queryRaw<
      { blocked: boolean }[]
    >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid)) AND strpos(query, ${queryFragment}) > 0) AS blocked`;
    return row.blocked;
  }, 'expected PostgreSQL row-lock wait');
}
// The real repository still performs every SQL operation; the proxy only pauses
// it AFTER a real row lock (or before cleanup's locking statement) for barriers.
function pausing(
  client: PrismaClient,
  pause: (tx: Prisma.TransactionClient, sql: Prisma.Sql) => Promise<void>,
  after = true,
) {
  return new AuthRepository(
    new Proxy(client, {
      get(target, property) {
        if (property !== '$transaction') return Reflect.get(target, property);
        return (
          fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options: object,
        ) =>
          target.$transaction(
            async (tx) =>
              fn(
                new Proxy(tx, {
                  get(transaction, key) {
                    if (key !== '$queryRaw')
                      return Reflect.get(transaction, key);
                    return async (
                      strings: TemplateStringsArray | Prisma.Sql,
                      ...values: unknown[]
                    ) => {
                      const sql = Array.isArray(strings)
                        ? Prisma.sql(strings as TemplateStringsArray, ...values)
                        : (strings as Prisma.Sql);
                      if (!after) await pause(tx, sql);
                      const result = await transaction.$queryRaw(sql);
                      if (after) await pause(tx, sql);
                      return result;
                    };
                  },
                }),
              ),
            options,
          );
      },
    }),
  );
}
async function heldSession(
  id: string,
  work: (pid: number, release: () => void) => Promise<void>,
) {
  const ready = deferred();
  const release = deferred();
  let pid = 0;
  const locking = independent.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${id}::uuid FOR UPDATE`;
      const [row] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      pid = row.pid;
      ready.resolve();
      await release.promise;
    },
    { timeout: 5000 },
  );
  try {
    await ready.promise;
    await work(pid, release.resolve);
  } finally {
    release.resolve();
    await locking;
  }
}
function cookie(token: string) {
  return `${config.cookieName}=${token}`;
}
function post(path: string, token?: string) {
  let req = request(app.getHttpServer())
    .post(path)
    .set('Origin', config.allowedOrigins[0])
    .set('X-LessonForge-CSRF', '1')
    .send(path === '/auth/login' ? { email: teacher!.email, password } : {});
  if (token) req = req.set('Cookie', cookie(token));
  return req;
}

it('applies both tracked migrations and stores only a hash, fixed expiry and one shared creation sample', async () => {
  const rows = await db.$queryRaw<
    { migration_name: string }[]
  >`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name`;
  expect(rows.map((row) => row.migration_name)).toEqual([
    '20261008000000_initial_domain',
    '20261009000000_add_sessions',
  ]);
  const login = await service.login(teacher!.email, password);
  const stored = await db.session.findUniqueOrThrow({
    where: { tokenHash: tokenHash(login.token) },
  });
  expect(stored.tokenHash).not.toBe(login.token);
  const [policy] = await db.$queryRaw<
    { same: boolean; eight: boolean }[]
  >`SELECT "createdAt" = "lastSeenAt" AS same, "expiresAt" = "createdAt" + interval '8 hours' AS eight FROM "Session" WHERE id = ${stored.id}::uuid`;
  expect(policy).toEqual({ same: true, eight: true });
  const recreated = createDatabaseClient(url);
  try {
    expect(
      await new AuthRepository(recreated).authenticate(tokenHash(login.token)),
    ).toEqual(login.principal);
  } finally {
    await recreated.$disconnect();
  }
});
it('verifies real passwords, preserves sessions on failed login, and keeps concurrent devices', async () => {
  const a = await service.login(teacher!.email, password);
  const b = await service.login(teacher!.email, password);
  await expect(
    service.login(teacher!.email, 'incorrect', a.token),
  ).rejects.toBeInstanceOf(LoginFailure);
  await expect(
    service.login('unknown@example.test', password),
  ).rejects.toBeInstanceOf(LoginFailure);
  expect(await repository.authenticate(tokenHash(a.token))).not.toBeNull();
  expect(await repository.authenticate(tokenHash(b.token))).not.toBeNull();
});
it('rotates transactionally, revokes the presented device only, and authenticates through real HTTP', async () => {
  const a = await service.login(teacher!.email, password);
  const otherDevice = await service.login(teacher!.email, password);
  const response = await post('/auth/login', a.token).expect(200);
  const raw = (response.headers['set-cookie'][0] as string)
    .split(';')[0]
    .split('=')[1];
  expect(raw).not.toBe(a.token);
  expect(await repository.authenticate(tokenHash(a.token))).toBeNull();
  expect(
    await repository.authenticate(tokenHash(otherDevice.token)),
  ).not.toBeNull();
  await request(app.getHttpServer())
    .get('/auth/me')
    .set('Cookie', cookie(raw))
    .expect(200);
  const safe = JSON.stringify(response.body);
  expect(safe).not.toContain(raw);
  expect(safe).not.toContain('Hash');
});
it('rolls back revocation on a real unique-token collision and refuses a changed verified password', async () => {
  const old = await session();
  const collision = await session();
  const before = await snapshot(old.id);
  let failure: unknown;
  try {
    await repository.rotate(teacher!, collision.hash, old.hash);
  } catch (error) {
    failure = error;
  }
  expect(sqlFailure(failure)).toEqual({
    code: '23505',
    constraint: 'Session_tokenHash_key',
  });
  expect(await snapshot(old.id)).toEqual(before);
  expect(await repository.authenticate(old.hash)).not.toBeNull();
  const changed = { ...teacher!, passwordHash: 'stale verified hash' };
  expect(
    await repository.rotate(changed, tokenHash(newToken()), old.hash),
  ).toBeNull();
  expect((await snapshot(old.id)).revoked).toBeNull();
});
it('waits for a concurrent password update and rejects the old verified hash without rotating', async () => {
  const account = await db.user.create({
    data: {
      email: 'password-update-first@example.test',
      displayName: 'Password race fixture',
      role: 'TEACHER',
      passwordHash: teacher!.passwordHash,
    },
  });
  const old = await service.login(account.email, password);
  const before = await db.session.findMany({ where: { userId: account.id } });
  const replacementHash = await passwords.hash('Replacement fixture password');
  const release = deferred();
  let pid = 0;
  // UPDATE holds a non-key row lock. An ordinary lookup sees the old committed
  // hash, but rotation's FOR SHARE must wait and re-read after this commits.
  const updating = independent
    .$transaction(
      async (tx) => {
        await tx.user.update({
          where: { id: account.id },
          data: { passwordHash: replacementHash },
        });
        const [row] = await tx.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;
        pid = row.pid;
        await release.promise;
      },
      { timeout: 5000 },
    )
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  let attempt: Promise<unknown> | undefined;
  try {
    await until(async () => pid !== 0, 'password update acquired its row lock');
    expect((await repository.findLoginUser(account.email))!.passwordHash).toBe(
      teacher!.passwordHash,
    );
    attempt = service.login(account.email, password, old.token).then(
      () => undefined,
      (error: unknown) => error,
    );
    await blockedBy(pid, 'FOR SHARE');
    expect(
      await db.session.findMany({ where: { userId: account.id } }),
    ).toEqual(before);
    release.resolve();
    expect(await updating).toBeUndefined();
    // Only the generic credential failure passes: lock/query errors cannot.
    expect(await attempt).toBeInstanceOf(LoginFailure);
    expect((await repository.findLoginUser(account.email))!.passwordHash).toBe(
      replacementHash,
    );
    expect(
      await db.session.findMany({ where: { userId: account.id } }),
    ).toEqual(before);
  } finally {
    release.resolve();
    await updating;
    await attempt;
  }
});
it('holds the final User share lock until rotation commits before a concurrent password update', async () => {
  const account = await db.user.create({
    data: {
      email: 'password-login-first@example.test',
      displayName: 'Password race fixture',
      role: 'TEACHER',
      passwordHash: teacher!.passwordHash,
    },
  });
  const old = await service.login(account.email, password);
  const replacementHash = await passwords.hash('Replacement fixture password');
  const release = deferred();
  let pid = 0;
  const locked = pausing(independent, async (tx, sql) => {
    if (!sql.sql.includes('FROM "User"') || !sql.sql.includes('FOR SHARE'))
      return;
    const [row] = await tx.$queryRaw<
      { pid: number }[]
    >`SELECT pg_backend_pid() AS pid`;
    pid = row.pid;
    await release.promise;
  });
  const login = new AuthService(locked, passwords)
    .login(account.email, password, old.token)
    .then(
      (result) => ({ result, error: undefined }),
      (error: unknown) => ({ result: undefined, error }),
    );
  let updating: Promise<unknown> | undefined;
  try {
    await until(async () => pid !== 0, 'login acquired its User share lock');
    updating = db.user
      .update({
        where: { id: account.id },
        data: { passwordHash: replacementHash },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    await blockedBy(pid, 'UPDATE');
    expect((await repository.findLoginUser(account.email))!.passwordHash).toBe(
      teacher!.passwordHash,
    );
    expect(await db.session.count({ where: { userId: account.id } })).toBe(1);
    release.resolve();
    const outcome = await login;
    expect(outcome.error).toBeUndefined();
    expect(outcome.result).toBeDefined();
    expect(await updating).toBeUndefined();
    expect((await repository.findLoginUser(account.email))!.passwordHash).toBe(
      replacementHash,
    );
    const sessions = await db.session.findMany({
      where: { userId: account.id },
    });
    expect(sessions).toHaveLength(2);
    expect(
      sessions.find((row) => row.tokenHash === tokenHash(old.token))!.revokedAt,
    ).not.toBeNull();
    expect(
      sessions.find(
        (row) => row.tokenHash === tokenHash(outcome.result!.token),
      )!.revokedAt,
    ).toBeNull();
  } finally {
    release.resolve();
    await login;
    await updating;
  }
});
it('retries real token collisions and rolls back all three failed rotation attempts', async () => {
  const old = await session();
  const collision = await session();
  let attempts = 0;
  const collisionRepository = pausing(
    independent,
    async (_tx, sql) => {
      if (!sql.sql.includes('INSERT INTO "Session"')) return;
      attempts++;
      if (attempts === 1) sql.values[2] = collision.hash;
    },
    false,
  );
  const retried = await new AuthService(collisionRepository, passwords).login(
    teacher!.email,
    password,
    old.token,
  );
  expect(attempts).toBe(2);
  expect(await repository.authenticate(old.hash)).toBeNull();
  expect(
    await repository.authenticate(tokenHash(retried.token)),
  ).not.toBeNull();
  const retained = await session();
  const before = await snapshot(retained.id);
  attempts = 0;
  const colliding = pausing(
    independent,
    async (_tx, sql) => {
      if (sql.sql.includes('INSERT INTO "Session"')) {
        attempts++;
        sql.values[2] = collision.hash;
      }
    },
    false,
  );
  await expect(
    new AuthService(colliding, passwords).login(
      teacher!.email,
      password,
      retained.token,
    ),
  ).rejects.toThrow('Service unavailable.');
  expect(attempts).toBe(3);
  expect(await snapshot(retained.id)).toEqual(before);
});
it('logout revokes only the current session, is idempotent, and refuses token replay', async () => {
  const a = await session();
  const b = await session();
  await post('/auth/logout', a.token).expect(204);
  const revoked = (await snapshot(a.id)).revoked;
  expect(revoked).not.toBeNull();
  await post('/auth/logout', a.token).expect(204);
  expect((await snapshot(a.id)).revoked).toBe(revoked);
  await request(app.getHttpServer())
    .get('/auth/me')
    .set('Cookie', cookie(a.token))
    .expect(401);
  expect(await repository.authenticate(b.hash)).not.toBeNull();
  await post('/auth/logout').expect(204);
});
it.each(['absolute', 'idle'])(
  'denies %s expiry without touching activity, including logout after expiry',
  async (kind) => {
    const row = await session(
      kind === 'absolute' ? '-1 second' : '8 hours',
      kind === 'idle' ? '-30 minutes' : '-1 minute',
    );
    const before = await snapshot(row.id);
    expect(await repository.authenticate(row.hash)).toBeNull();
    expect(await snapshot(row.id)).toEqual(before);
    await post('/auth/logout', row.token).expect(204);
    expect((await snapshot(row.id)).seen).toBe(before.seen);
  },
);
it.each(['absolute', 'idle'])(
  'uses fresh time after a real lock wait crossing %s expiry',
  async (kind) => {
    const row = await session(
      kind === 'absolute' ? '1 second' : '8 hours',
      kind === 'idle' ? '-1799 seconds' : '0 seconds',
    );
    const before = await snapshot(row.id);
    await heldSession(row.id, async (pid, release) => {
      const pending = repository.authenticate(row.hash);
      // Attach immediately so unexpected timeouts are propagated, not unhandled.
      const outcome = pending.then(
        (result) => ({ result }),
        () => {
          throw new Error(
            'Authentication lock test returned a database failure, not expiry denial.',
          );
        },
      );
      await blockedBy(pid);
      const [valid] = await db.$queryRaw<
        { valid: boolean }[]
      >`SELECT "expiresAt" > clock_timestamp() AND "lastSeenAt" > clock_timestamp() - interval '30 minutes' AS valid FROM "Session" WHERE id = ${row.id}::uuid`;
      expect(valid.valid).toBe(true);
      await until(async () => {
        const [expired] = await db.$queryRaw<
          { expired: boolean }[]
        >`SELECT "expiresAt" <= clock_timestamp() OR "lastSeenAt" <= clock_timestamp() - interval '30 minutes' AS expired FROM "Session" WHERE id = ${row.id}::uuid`;
        return expired.expired;
      }, 'expiry boundary');
      release();
      expect((await outcome).result).toBeNull();
    });
    expect(await snapshot(row.id)).toEqual(before);
  },
);
it('preserves exact microsecond boundary equality through SQL predicates', async () => {
  // A controlled post-lock DB timestamp equals each boundary exactly; no JS Date conversion.
  for (const boundary of ['expires', 'idle']) {
    const row = await session();
    const boundaryDb = new Proxy(independent, {
      get(target, property) {
        if (property !== '$transaction') return Reflect.get(target, property);
        return (
          fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options: object,
        ) =>
          independent.$transaction(
            async (tx) =>
              fn(
                new Proxy(tx, {
                  get(t, key) {
                    if (key !== '$queryRaw') return Reflect.get(t, key);
                    return (
                      strings: TemplateStringsArray,
                      ...values: unknown[]
                    ) => {
                      if (strings[0].includes('SELECT clock_timestamp()::text'))
                        return tx.$queryRaw(
                          Prisma.sql`SELECT (${boundary === 'expires' ? Prisma.sql`"expiresAt"` : Prisma.sql`"lastSeenAt" + interval '30 minutes'`})::text AS t FROM "Session" WHERE id = ${row.id}::uuid`,
                        );
                      return t.$queryRaw(strings, ...values);
                    };
                  },
                }),
              ),
            options,
          );
      },
    });
    const before = await snapshot(row.id);
    expect(
      await new AuthRepository(boundaryDb).authenticate(row.hash),
    ).toBeNull();
    expect(await snapshot(row.id)).toEqual(before);
  }
});
it('never moves activity backwards, even with a later-stored timestamp, and never extends absolute expiry', async () => {
  const row = await session('8 hours', '1 second');
  const before = await snapshot(row.id);
  expect(await repository.authenticate(row.hash)).not.toBeNull();
  expect(await snapshot(row.id)).toEqual(before);
});
it('commits activity before subsequent role rejection and leaves invalid authentication untouched', async () => {
  const row = await session('8 hours', '-10 minutes');
  const before = await snapshot(row.id);
  await request(app.getHttpServer())
    .get('/live-role')
    .set('Cookie', cookie(row.token))
    .expect(403);
  const [advanced] = await db.$queryRaw<
    { advanced: boolean }[]
  >`SELECT "lastSeenAt" > ${before.seen}::timestamptz AS advanced FROM "Session" WHERE id = ${row.id}::uuid`;
  expect(advanced.advanced).toBe(true);
  const expired = await session('-1 second', '-1 minute');
  const old = await snapshot(expired.id);
  await request(app.getHttpServer())
    .get('/live-role')
    .set('Cookie', cookie(expired.token))
    .expect(401);
  expect(await snapshot(expired.id)).toEqual(old);
});
it.each(['revoke', 'authenticate'] as const)(
  'serializes %s first against its waiting competitor without resurrection',
  async (first) => {
    const row = await session('8 hours', '-1 minute');
    const ready = deferred();
    const release = deferred();
    let pid = 0;
    const holder = pausing(independent, async (tx, sql) => {
      if (!sql.sql.includes('FOR UPDATE')) return;
      const [backend] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      pid = backend.pid;
      ready.resolve();
      await release.promise;
    });
    const holding = holder[first](row.hash);
    try {
      await ready.promise;
      const waiting =
        first === 'revoke'
          ? repository.authenticate(row.hash)
          : repository.revoke(row.hash);
      await blockedBy(pid);
      release.resolve();
      const firstResult = await holding;
      const next = await waiting;
      if (first === 'revoke') expect(next).toBeNull();
      else expect(firstResult).not.toBeNull();
      const final = await snapshot(row.id);
      expect(final.revoked).not.toBeNull();
      expect(await repository.authenticate(row.hash)).toBeNull();
      expect(await snapshot(row.id)).toEqual(final);
    } finally {
      release.resolve();
      await holding;
    }
  },
);
it('uses lock order rather than transaction-start order for concurrent activity', async () => {
  const row = await session('8 hours', '-1 minute');
  const earlierStarted = deferred();
  const letEarlierLock = deferred();
  const earlier = pausing(
    independent,
    async (_tx, sql) => {
      if (!sql.sql.includes('FOR UPDATE')) return;
      earlierStarted.resolve();
      await letEarlierLock.promise;
    },
    false,
  );
  const pending = earlier.authenticate(row.hash);
  try {
    await earlierStarted.promise;
    expect(await repository.authenticate(row.hash)).not.toBeNull();
    const committed = await snapshot(row.id);
    letEarlierLock.resolve();
    expect(await pending).not.toBeNull();
    const [monotonic] = await db.$queryRaw<
      { valid: boolean }[]
    >`SELECT "lastSeenAt" >= ${committed.seen}::timestamptz AND "expiresAt" = ${committed.expires}::timestamptz AS valid FROM "Session" WHERE id = ${row.id}::uuid`;
    expect(monotonic.valid).toBe(true);
  } finally {
    letEarlierLock.resolve();
    await pending;
  }
});

function sqlFailure(error: unknown) {
  const meta = (
    error as {
      meta?: {
        code?: string;
        driverAdapterError?: {
          cause?: {
            originalCode?: string;
            constraint?: { index?: string };
            originalMessage?: string;
          };
        };
      };
    }
  )?.meta;
  const cause = meta?.driverAdapterError?.cause;
  // PG adapter may not project a check name as an index; extract only that name
  // from the buffered message, never expose the driver text/row contents.
  const match = cause?.originalMessage?.match(
    /violates check constraint "([A-Za-z_]+)"/,
  );
  return {
    code: cause?.originalCode ?? meta?.code ?? 'no SQLSTATE',
    constraint: cause?.constraint?.index ?? match?.[1],
  };
}
async function rejects(
  statement: Prisma.Sql,
  code: string,
  constraint: string,
) {
  let error: unknown;
  try {
    await db.$executeRaw(statement);
  } catch (caught) {
    error = caught;
  }
  expect(sqlFailure(error)).toEqual({ code, constraint });
}
it('enforces the unique hash and User FK with real PostgreSQL failures', async () => {
  const row = await session();
  await rejects(
    Prisma.sql`INSERT INTO "Session" SELECT ${randomUUID()}::uuid, "userId", "tokenHash", "createdAt", "expiresAt", "lastSeenAt", "revokedAt" FROM "Session" WHERE id = ${row.id}::uuid`,
    '23505',
    'Session_tokenHash_key',
  );
  await rejects(
    Prisma.sql`UPDATE "Session" SET "userId" = ${randomUUID()}::uuid WHERE id = ${row.id}::uuid`,
    '23503',
    'Session_userId_fkey',
  );
  // Isolate a user referenced only by Session so domain FKs cannot mask this restriction.
  const onlySession = await db.user.create({
    data: {
      email: 'session-only@example.test',
      displayName: 'Isolated FK fixture',
      passwordHash: teacher!.passwordHash,
      role: 'TEACHER',
    },
  });
  await db.$executeRaw`UPDATE "Session" SET "userId" = ${onlySession.id}::uuid WHERE id = ${row.id}::uuid`;
  await rejects(
    Prisma.sql`DELETE FROM "User" WHERE id = ${onlySession.id}::uuid`,
    '23503',
    'Session_userId_fkey',
  );
  await rejects(
    Prisma.sql`UPDATE "User" SET id = ${randomUUID()}::uuid WHERE id = ${onlySession.id}::uuid`,
    '23503',
    'Session_userId_fkey',
  );
  expect(
    (await db.session.findUniqueOrThrow({ where: { id: row.id } })).userId,
  ).toBe(onlySession.id);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: onlySession.id } })).id,
  ).toBe(onlySession.id);
});
it.each([
  ['hash', 'Session_tokenHash_check'],
  ['expiry', 'Session_expiry_check'],
  ['early-activity', 'Session_activity_check'],
  ['late-activity', 'Session_activity_check'],
  ['revocation', 'Session_revocation_check'],
])(
  'enforces %s shape/order independently of other checks',
  async (kind, constraint) => {
    const row = await session();
    const before = await snapshot(row.id);
    const assignment =
      kind === 'hash'
        ? Prisma.sql`"tokenHash" = ${'A'.repeat(64)}`
        : kind === 'expiry'
          ? Prisma.sql`"expiresAt" = "createdAt"`
          : kind === 'early-activity'
            ? Prisma.sql`"lastSeenAt" = "createdAt" - interval '1 microsecond'`
            : kind === 'late-activity'
              ? Prisma.sql`"lastSeenAt" = "expiresAt"`
              : Prisma.sql`"revokedAt" = "createdAt" - interval '1 microsecond'`;
    if (kind === 'expiry') {
      // Expiry <= creation necessarily also violates activity ordering. Remove only
      // that overlapping check inside a transaction, then roll back ALL DDL/data.
      // This proves the expiry check itself using a real named PostgreSQL failure.
      const rollback = new Error('Intentional disposable fixture rollback');
      try {
        await db.$transaction(async (tx) => {
          await tx.$executeRaw`ALTER TABLE "Session" DROP CONSTRAINT "Session_activity_check"`;
          let failure: unknown;
          try {
            await tx.$executeRaw`UPDATE "Session" SET ${assignment} WHERE id = ${row.id}::uuid`;
          } catch (error) {
            failure = error;
          }
          expect(sqlFailure(failure)).toEqual({ code: '23514', constraint });
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      }
      const [restored] = await db.$queryRaw<
        { present: boolean }[]
      >`SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Session_activity_check') AS present`;
      expect(restored.present).toBe(true);
    } else
      await rejects(
        Prisma.sql`UPDATE "Session" SET ${assignment} WHERE id = ${row.id}::uuid`,
        '23514',
        constraint,
      );
    expect(await snapshot(row.id)).toEqual(before);
  },
);
it('rejects SQL NULL in every required Session column', async () => {
  const row = await session();
  for (const field of [
    'id',
    'userId',
    'tokenHash',
    'createdAt',
    'expiresAt',
    'lastSeenAt',
  ]) {
    let failure: unknown;
    try {
      await db.$executeRawUnsafe(
        `UPDATE "Session" SET "${field}" = NULL WHERE id = $1::uuid`,
        row.id,
      );
    } catch (error) {
      failure = error;
    }
    expect(sqlFailure(failure).code).toBe('23502');
  }
});
it('cleans only invalid rows, skips locked sessions, preserves domain history and never revives deleted rows', async () => {
  await repository.cleanup(); // Remove earlier invalid fixtures, preserving valid sessions.
  const active = await session();
  const expired = await session('-1 second', '-1 minute');
  const idle = await session('8 hours', '-31 minutes');
  const revoked = await session();
  await repository.revoke(revoked.hash);
  const expiredLocked = await session('-1 second', '-1 minute');
  const before = await domainSnapshot();
  await heldSession(expiredLocked.id, async (_pid, release) => {
    expect(await repository.cleanup()).toBe(3);
    expect(await snapshot(expiredLocked.id)).toBeDefined();
    release();
  });
  expect(await repository.cleanup()).toBe(1);
  expect(await snapshot(active.id)).toBeDefined();
  for (const row of [expired, idle, revoked, expiredLocked]) {
    expect(await snapshot(row.id)).toBeUndefined();
    expect(await repository.authenticate(row.hash)).toBeNull();
  }
  expect(await domainSnapshot()).toEqual(before);
  // Session-only FK fixture account is intentionally added by an earlier test.
  expect(((await domainSnapshot()) as unknown[]).slice(1)).toEqual(
    (domainBefore as unknown[]).slice(1),
  );
});
it('preserves a row refreshed by activity before cleanup locks it', async () => {
  const row = await session('8 hours', '-1799 seconds');
  const old = await snapshot(row.id);
  const ready = deferred();
  const release = deferred();
  const cleanup = pausing(
    independent,
    async (_tx, sql) => {
      if (!sql.sql.includes('SKIP LOCKED')) return;
      ready.resolve();
      await release.promise;
    },
    false,
  );
  const pending = cleanup.cleanup();
  try {
    await ready.promise;
    expect(await repository.authenticate(row.hash)).not.toBeNull();
    await until(async () => {
      const [crossed] = await db.$queryRaw<
        { expired: boolean }[]
      >`SELECT clock_timestamp() >= ${old.seen}::timestamptz + interval '30 minutes' AS expired`;
      return crossed.expired;
    }, 'original idle boundary after renewal');
    release.resolve();
    await pending;
    expect(await snapshot(row.id)).toBeDefined();
    expect(await repository.authenticate(row.hash)).not.toBeNull();
  } finally {
    release.resolve();
    await pending;
  }
});
it('deletes at most 1000 rows per batch and 10000 per invocation', async () => {
  await repository.cleanup();
  const id = randomUUID();
  await db.$executeRaw`
    INSERT INTO "Session" (id, "userId", "tokenHash", "createdAt", "expiresAt", "lastSeenAt", "revokedAt")
    SELECT (md5(${id} || n::text))::uuid, ${teacher!.id}::uuid, md5(${id} || n::text) || md5(n::text || ${id}), clock_timestamp() - interval '2 hours', clock_timestamp() + interval '8 hours', clock_timestamp(), clock_timestamp() FROM generate_series(1, 10005) n
  `;
  let batches = 0;
  const checked = pausing(independent, async (_tx, sql) => {
    if (sql.sql.includes('SKIP LOCKED')) batches++;
  });
  expect(await checked.cleanup()).toBe(10000);
  expect(batches).toBe(10);
  expect(await repository.cleanup()).toBe(5);
  expect(((await domainSnapshot()) as unknown[]).slice(1)).toEqual(
    (domainBefore as unknown[]).slice(1),
  );
});

it('cleanup skips activity locked past the old idle boundary, then preserves committed renewal', async () => {
  await repository.cleanup();
  const row = await session('8 hours', '-1799 seconds');
  const before = await snapshot(row.id);
  const ready = deferred();
  const release = deferred();
  const renewing = pausing(independent, async (_tx, sql) => {
    if (!sql.sql.includes('RETURNING u.id')) return;
    ready.resolve();
    await release.promise;
  });
  const pending = renewing.authenticate(row.hash);
  try {
    await ready.promise;
    await until(async () => {
      const [crossed] = await db.$queryRaw<
        { expired: boolean }[]
      >`SELECT clock_timestamp() >= ${before.seen}::timestamptz + interval '30 minutes' AS expired`;
      return crossed.expired;
    }, 'old idle boundary while renewal holds lock');
    expect(await repository.cleanup()).toBe(0);
    release.resolve();
    expect(await pending).not.toBeNull();
    expect(await repository.cleanup()).toBe(0);
    expect(await repository.authenticate(row.hash)).not.toBeNull();
  } finally {
    release.resolve();
    await pending;
  }
});
it('cleanup skips an expired session locked by revocation and deletes it after commit', async () => {
  await repository.cleanup();
  const row = await session('-1 second', '-1 minute');
  const ready = deferred();
  const release = deferred();
  const revoking = pausing(independent, async (_tx, sql) => {
    if (!sql.sql.includes('FOR UPDATE')) return;
    ready.resolve();
    await release.promise;
  });
  const pending = revoking.revoke(row.hash);
  try {
    await ready.promise;
    expect(await repository.cleanup()).toBe(0);
    release.resolve();
    await pending;
    expect((await snapshot(row.id)).revoked).not.toBeNull();
    expect(await repository.cleanup()).toBe(1);
    expect(await repository.authenticate(row.hash)).toBeNull();
    expect(await snapshot(row.id)).toBeUndefined();
  } finally {
    release.resolve();
    await pending;
  }
});
