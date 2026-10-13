import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { createDatabaseClient } from '../src/prisma/prisma.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { AccountsService } from '../src/auth/accounts.service.js';
import { ProvisioningCancelled } from '../src/auth/accounts.input.js';
import { initializeConstraintDatabase } from './support/constraint-preflight.js';
import { resolveConstraintDatabaseUrl } from './support/constraint-database.js';

let db: PrismaClient;
let independent: PrismaClient;
let passwords: PasswordService;
let service: AccountsService;
let baseline: unknown;
const password = ' Disposable Unicode 🔒 password ';

async function history() {
  const rows: unknown[] = [];
  for (const table of [
    'CurriculumResource',
    'Lesson',
    'LessonRevision',
    'Review',
    'RevisionSource',
    'Session',
  ])
    rows.push(
      await db.$queryRawUnsafe(
        `SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
      ),
    );
  return rows;
}
beforeAll(async () => {
  const url = resolveConstraintDatabaseUrl(
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
      throw new Error('Provisioning disposable migration deployment failed.');
    }
  });
  independent = createDatabaseClient(url);
  passwords = new PasswordService();
  service = new AccountsService(db, passwords);
  const anchor = await db.user.create({
    data: {
      email: 'history-anchor@example.test',
      displayName: 'History anchor',
      role: 'TEACHER',
      passwordHash: await passwords.hash(password),
    },
  });
  await db.curriculumResource.create({
    data: {
      title: 'Preserved fixture',
      subject: 'Mathematics',
      grade: 'Grade 4',
      sourceReference: 'Disposable demonstration',
      contentText: 'One half.',
    },
  });
  await db.lesson.create({ data: { ownerId: anchor.id } });
  await db.session.create({
    data: {
      userId: anchor.id,
      tokenHash: 'a'.repeat(64),
      createdAt: new Date('2026-01-01'),
      lastSeenAt: new Date('2026-01-01'),
      expiresAt: new Date('2026-01-02'),
    },
  });
  baseline = await history();
});
afterAll(async () => {
  try {
    if (baseline) expect(await history()).toEqual(baseline);
  } finally {
    await passwords?.onModuleDestroy();
    await Promise.allSettled([db?.$disconnect(), independent?.$disconnect()]);
  }
});
function input() {
  const key = randomUUID();
  return {
    teacher: {
      email: `${key}-teacher@example.test`,
      displayName: 'Teacher fixture',
    },
    admin: {
      email: `${key}-admin@example.test`,
      displayName: 'Administrator fixture',
    },
  };
}
const credentials = { teacher: password, admin: password };
async function snapshot(details: ReturnType<typeof input>) {
  return db.$queryRaw`SELECT to_jsonb(u) AS row FROM "User" u WHERE email IN (${details.teacher.email}, ${details.admin.email}) ORDER BY email`;
}
function deferred() {
  let resolve!: () => void;
  let ready = false;
  const promise = new Promise<void>((r) => {
    resolve = () => {
      ready = true;
      r();
    };
  });
  return { promise, resolve, ready: () => ready };
}
async function until(check: () => Promise<boolean>, label: string) {
  const deadline = performance.now() + 2500;
  while (!(await check())) {
    if (performance.now() > deadline)
      throw new Error(`Provisioning synchronization failed: ${label}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}
// Execute production SQL/Prisma operations first, then coordinate real transactions.
function intercepted(
  client: PrismaClient,
  afterRead?: (tx: Prisma.TransactionClient) => Promise<void>,
  afterCreate?: () => Promise<void>,
) {
  return new Proxy(client, {
    get(target, property) {
      if (property !== '$transaction') return Reflect.get(target, property);
      return (
        work: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options: object,
      ) =>
        target.$transaction(
          async (tx) =>
            work(
              new Proxy(tx, {
                get(transaction, key) {
                  if (key === '$queryRaw')
                    return async (
                      strings: TemplateStringsArray,
                      ...values: unknown[]
                    ) => {
                      const result = await transaction.$queryRaw(
                        Prisma.sql(strings, ...values),
                      );
                      await afterRead?.(transaction);
                      return result;
                    };
                  if (key === 'user')
                    return new Proxy(transaction.user, {
                      get(user, method) {
                        if (method !== 'create')
                          return Reflect.get(user, method);
                        return async (args: Prisma.UserCreateArgs) => {
                          const result = await user.create(args);
                          await afterCreate?.();
                          return result;
                        };
                      },
                    });
                  return Reflect.get(transaction, key);
                },
              }),
            ),
          options,
        );
    },
  });
}

it('creates canonical teacher/admin accounts with real verifiable Argon2 hashes and persistence', async () => {
  const details = input();
  const supplied = {
    teacher: {
      email: ` ${details.teacher.email.toUpperCase()} `,
      displayName: ` ${details.teacher.displayName} `,
    },
    admin: details.admin,
  };
  expect(await service.provision(supplied, credentials)).toEqual([
    { key: 'teacher', status: 'created' },
    { key: 'admin', status: 'created' },
  ]);
  const rows = await independent.user.findMany({
    where: { email: { in: [details.teacher.email, details.admin.email] } },
  });
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row.role).toBe(
      row.email === details.teacher.email ? 'TEACHER' : 'ADMIN',
    );
    expect(row.displayName).toBe(
      row.email === details.teacher.email
        ? details.teacher.displayName
        : details.admin.displayName,
    );
    expect(await passwords.verify(row.passwordHash, password)).toBe(true);
    expect(await passwords.verify(row.passwordHash, password.trim())).toBe(
      false,
    );
  }
  const recreated = createDatabaseClient(
    resolveConstraintDatabaseUrl(
      process.env.CONSTRAINT_TEST_DATABASE_URL,
      process.env.LESSONFORGE_CONSTRAINT_TEST,
    ),
  );
  try {
    expect(
      await recreated.user.findMany({
        where: { id: { in: rows.map((row) => row.id) } },
      }),
    ).toHaveLength(2);
  } finally {
    await recreated.$disconnect();
  }
});
it('matching reruns never hash, update timestamps, replace passwords/IDs, or change roles/names', async () => {
  const details = input();
  await service.provision(details, credentials);
  const before = await snapshot(details);
  const hash = vi.fn(async () => {
    throw new Error('Rerun must not hash');
  });
  const rerun = new AccountsService(db, { hash });
  expect(await rerun.provision(details, {})).toEqual([
    { key: 'teacher', status: 'unchanged' },
    { key: 'admin', status: 'unchanged' },
  ]);
  expect(
    await rerun.provision(details, { teacher: 'ignored', admin: 'ignored' }),
  ).toEqual([
    { key: 'teacher', status: 'unchanged' },
    { key: 'admin', status: 'unchanged' },
  ]);
  expect(hash).not.toHaveBeenCalled();
  expect(await snapshot(details)).toEqual(before);
});
it('creates only the missing account without asking for or hashing an existing password', async () => {
  const details = input();
  await db.user.create({
    data: {
      ...details.teacher,
      role: 'TEACHER',
      passwordHash: await passwords.hash(password),
    },
  });
  const before = await db.user.findUniqueOrThrow({
    where: { email: details.teacher.email },
  });
  expect(await service.provision(details, { admin: password })).toEqual([
    { key: 'teacher', status: 'unchanged' },
    { key: 'admin', status: 'created' },
  ]);
  expect(
    await db.user.findUniqueOrThrow({
      where: { email: details.teacher.email },
    }),
  ).toEqual(before);
});
it.each(['role', 'name'])(
  'refuses an existing %s conflict without creating its missing companion',
  async (kind) => {
    const details = input();
    await db.user.create({
      data: {
        ...details.admin,
        displayName: kind === 'name' ? 'Different' : details.admin.displayName,
        role: kind === 'role' ? 'TEACHER' : 'ADMIN',
        passwordHash: await passwords.hash(password),
      },
    });
    const before = await snapshot(details);
    await expect(service.provision(details, credentials)).rejects.toThrow(
      'different role or display name',
    );
    expect(await snapshot(details)).toEqual(before);
  },
);
it('rolls back a real first insert when a later operation fails', async () => {
  const details = input();
  let inserts = 0;
  const failing = new AccountsService(
    intercepted(db, undefined, async () => {
      if (++inserts === 2) throw new Error('Deliberate fixture failure');
    }),
    passwords,
  );
  await expect(failing.provision(details, credentials)).rejects.toThrow(
    'Deliberate fixture failure',
  );
  expect(inserts).toBe(2);
  expect(await snapshot(details)).toEqual([]);
});
it('cancellation after a real first insert rolls back both accounts', async () => {
  const details = input();
  const cancellation = new AbortController();
  const cancelling = new AccountsService(
    intercepted(db, undefined, async () => {
      cancellation.abort();
    }),
    passwords,
  );
  await expect(
    cancelling.provision(details, credentials, cancellation.signal),
  ).rejects.toBeInstanceOf(ProvisioningCancelled);
  expect(await snapshot(details)).toEqual([]);
});
it('rechecks a role/name change made after preliminary inspection before creating either account', async () => {
  const details = input();
  await db.user.create({
    data: {
      ...details.admin,
      role: 'ADMIN',
      passwordHash: await passwords.hash(password),
    },
  });
  let updated = false;
  const changing = new AccountsService(db, {
    hash: async (value) => {
      await independent.user.update({
        where: { email: details.admin.email },
        data: { displayName: 'Concurrent replacement' },
      });
      updated = true;
      return passwords.hash(value);
    },
  });
  await expect(
    changing.provision(details, { teacher: password }),
  ).rejects.toThrow('different role or display name');
  expect(updated).toBe(true);
  expect(
    await db.user.findUnique({ where: { email: details.teacher.email } }),
  ).toBeNull();
  expect(
    (await db.user.findUniqueOrThrow({ where: { email: details.admin.email } }))
      .displayName,
  ).toBe('Concurrent replacement');
});
it('aborts and rolls back an earlier insert when a real concurrent email insert wins', async () => {
  const details = input();
  const ready = deferred();
  const release = deferred();
  const racing = new AccountsService(
    intercepted(db, async () => {
      ready.resolve();
      await release.promise;
    }),
    passwords,
  );
  const pending = racing.provision(details, credentials).then(
    (result) => ({ result, error: undefined }),
    (error: unknown) => ({ result: undefined, error }),
  );
  try {
    await until(
      async () => ready.ready(),
      'provisioning completed its locked recheck',
    );
    const winner = await independent.user.create({
      data: {
        ...details.admin,
        role: 'ADMIN',
        passwordHash: await passwords.hash(
          'Independent winning fixture password',
        ),
      },
    });
    const before = await snapshot(details);
    release.resolve();
    const outcome = await pending;
    expect(outcome.result).toBeUndefined();
    expect(outcome.error).toMatchObject({
      message:
        'An account was inserted concurrently. No accounts were provisioned; rerun the command.',
    });
    expect(await snapshot(details)).toEqual(before);
    expect(
      await db.user.findUnique({ where: { email: details.teacher.email } }),
    ).toBeNull();
    expect(
      await db.user.findUniqueOrThrow({
        where: { email: details.admin.email },
      }),
    ).toEqual(winner);
    // A deliberate rerun applies the same matching policy without touching the winner.
    expect(await service.provision(details, { teacher: password })).toEqual([
      { key: 'teacher', status: 'created' },
      { key: 'admin', status: 'unchanged' },
    ]);
    expect(
      await db.user.findUniqueOrThrow({
        where: { email: details.admin.email },
      }),
    ).toEqual(winner);
  } finally {
    release.resolve();
    await pending;
  }
});
it('retains existing-account share locks until commit against a real conflicting UPDATE', async () => {
  const details = input();
  await service.provision(details, credentials);
  const ready = deferred();
  const release = deferred();
  let pid = 0;
  const holding = new AccountsService(
    intercepted(independent, async (tx) => {
      const [row] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      pid = row.pid;
      ready.resolve();
      await release.promise;
    }),
    passwords,
  );
  const pending = holding.provision(details, {}).then(
    (result) => ({ result, error: undefined }),
    (error: unknown) => ({ result: undefined, error }),
  );
  let updating: Promise<unknown> | undefined;
  try {
    await until(
      async () => ready.ready(),
      'provisioning acquired its share locks',
    );
    updating = db.user
      .update({
        where: { email: details.teacher.email },
        data: { displayName: 'Update after commit' },
      })
      .then(
        (result) => ({ result, error: undefined }),
        (error: unknown) => ({ result: undefined, error }),
      );
    await until(async () => {
      const [row] = await db.$queryRaw<
        { blocked: boolean }[]
      >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid)) AND strpos(query, 'UPDATE') > 0) AS blocked`;
      return row.blocked;
    }, 'existing-account UPDATE waits for provisioning share lock');
    expect(
      (
        await db.user.findUniqueOrThrow({
          where: { email: details.teacher.email },
        })
      ).displayName,
    ).toBe(details.teacher.displayName);
    release.resolve();
    const result = await pending;
    expect(result.error).toBeUndefined();
    expect(
      result.result?.every((account) => account.status === 'unchanged'),
    ).toBe(true);
    expect(await updating).toMatchObject({ error: undefined });
    expect(
      (
        await db.user.findUniqueOrThrow({
          where: { email: details.teacher.email },
        })
      ).displayName,
    ).toBe('Update after commit');
  } finally {
    release.resolve();
    await pending;
    await updating;
  }
});
