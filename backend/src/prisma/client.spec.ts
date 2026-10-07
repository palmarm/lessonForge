const constructors = vi.hoisted(() => ({ adapter: vi.fn(), client: vi.fn() }));
vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class {
    constructor(...args: unknown[]) {
      constructors.adapter(...args);
    }
  },
}));
vi.mock('../generated/prisma/client.js', () => ({
  PrismaClient: class {
    constructor(...args: unknown[]) {
      constructors.client(...args);
    }
  },
}));
import { createDatabaseClient } from './prisma.service.js';

it('bounds pool acquisition and queries and suppresses raw Prisma error logs', () => {
  createDatabaseClient(
    'postgresql://fixture:fixture@127.0.0.1/lessonforge_dev',
  );
  expect(constructors.adapter).toHaveBeenCalledWith(
    {
      connectionString:
        'postgresql://fixture:fixture@127.0.0.1/lessonforge_dev',
      max: 5,
      connectionTimeoutMillis: 5_000,
      query_timeout: 5_000,
      statement_timeout: 5_000,
    },
    {
      onPoolError: expect.any(Function),
      onConnectionError: expect.any(Function),
    },
  );
  expect(constructors.client).toHaveBeenCalledWith({
    adapter: expect.anything(),
    log: [],
  });
});
