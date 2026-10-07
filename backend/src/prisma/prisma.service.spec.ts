import { Logger } from '@nestjs/common';
import {
  PrismaService,
  databaseFailureMessage,
  type DatabaseClient,
} from './prisma.service.js';

describe('Prisma lifecycle', () => {
  const connect = vi.fn();
  const disconnect = vi.fn();
  const query = vi.fn();
  const errorLog = vi.fn();
  let service: PrismaService;

  beforeEach(() => {
    vi.resetAllMocks();
    connect.mockResolvedValue(undefined);
    disconnect.mockResolvedValue(undefined);
    query.mockResolvedValue([{ ok: 1 }]);
    service = new PrismaService({
      $connect: connect,
      $disconnect: disconnect,
      $queryRaw: query,
    } as unknown as DatabaseClient);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(errorLog);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(['connect', 'query'])(
    'bounds initialization if %s never settles',
    async (stage) => {
      vi.useFakeTimers();
      try {
        if (stage === 'connect')
          connect.mockImplementation(() => new Promise(() => {}));
        else query.mockImplementation(() => new Promise(() => {}));
        const pending = expect(service.onModuleInit()).rejects.toThrow(
          'Database operation timed out.',
        );
        await vi.advanceTimersByTimeAsync(12_000);
        await pending;
        expect(disconnect).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('connects and checks the actual SELECT 1 result before completing initialization', async () => {
    let finish!: (value: { ok: number }[]) => void;
    query.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const initialized = vi.fn();
    const pending = service.onModuleInit().then(initialized);
    await vi.waitFor(() => expect(query).toHaveBeenCalled());
    expect(connect).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toEqual(['SELECT 1 AS ok']);
    expect(initialized).not.toHaveBeenCalled();
    finish([{ ok: 1 }]);
    await pending;
    expect(initialized).toHaveBeenCalledOnce();
  });

  it('does not query if connect resolves after the initialization deadline', async () => {
    vi.useFakeTimers();
    try {
      let finish!: () => void;
      connect.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      const pending = expect(service.onModuleInit()).rejects.toThrow(
        'Database operation timed out.',
      );
      await vi.advanceTimersByTimeAsync(12_000);
      await pending;
      finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(query).not.toHaveBeenCalled();
      expect(disconnect).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['connect', 'query', 'result'])(
    'releases connections on %s failure without leaking driver details',
    async (stage) => {
      const failure = new Error('secret-password postgres://private');
      if (stage === 'connect') connect.mockRejectedValue(failure);
      if (stage === 'query') query.mockRejectedValue(failure);
      if (stage === 'result') query.mockResolvedValue([{ ok: 0 }]);
      await expect(service.onModuleInit()).rejects.toThrow(
        'Database connection or query failed.',
      );
      expect(disconnect).toHaveBeenCalledOnce();
      await service.onModuleDestroy();
      expect(disconnect).toHaveBeenCalledOnce();
    },
  );

  it('disconnects once on repeated shutdown', async () => {
    await service.onModuleInit();
    await service.onModuleDestroy();
    await service.onModuleDestroy();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('retains the safe initialization error even if cleanup also fails', async () => {
    connect.mockRejectedValue({ code: 'ECONNREFUSED', message: 'private' });
    disconnect.mockRejectedValue(new Error('secret'));
    await expect(service.onModuleInit()).rejects.toThrow(
      'Database server unavailable.',
    );
    expect(errorLog).toHaveBeenCalledWith(
      'Database cleanup failed after initialization failure.',
    );
  });

  it('sanitizes shutdown failure', async () => {
    disconnect.mockRejectedValue(new Error('secret'));
    await expect(service.onModuleDestroy()).rejects.toThrow(
      'Database connection cleanup failed.',
    );
  });

  it.each([
    ['28P01', 'authentication failed'],
    ['ECONNREFUSED', 'server unavailable'],
    ['ETIMEDOUT', 'operation timed out'],
    ['57014', 'operation timed out'],
    ['secret-code', 'connection or query failed'],
  ])('uses only known failure categories for %s', (code, reason) => {
    expect(databaseFailureMessage({ code, message: 'secret' })).toBe(
      `Database ${reason}. Check PostgreSQL readiness and backend DATABASE_URL configuration.`,
    );
  });
});
