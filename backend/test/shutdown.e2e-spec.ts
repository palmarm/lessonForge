import { once } from 'node:events';
import { createConnection, type Socket, type AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';

const database = vi.hoisted(() => ({
  $connect: vi.fn(async () => undefined),
  $disconnect: vi.fn(async () => undefined),
  $queryRaw: vi.fn(async () => [{ ok: 1 }]),
}));
vi.mock('../src/config/environment.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/config/environment.js')>()),
  loadBackendEnvironment: vi.fn(),
}));
vi.mock('../src/prisma/prisma.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/prisma/prisma.service.js')>()),
  createDatabaseClient: () => database,
}));
// The production bootstrap and HTTP adapter run unchanged; ask the OS for a
// free test port, independently of any API the developer already has running.
// Native KDF behavior is tested separately; this fixture isolates socket/signal disposal.
vi.mock('../src/auth/password.service.js', () => ({
  PasswordService: class {},
}));
vi.mock('../src/port.js', () => ({ resolvePort: () => 0 }));
import { startApplication } from '../src/bootstrap.js';

describe.each(['close', 'SIGINT', 'SIGTERM'] as const)(
  'production %s shutdown with open HTTP connections',
  (trigger) => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.stubEnv(
        'DATABASE_URL',
        'postgresql://fixture:fixture@127.0.0.1:5433/lessonforge_dev',
      );
    });
    afterEach(() => vi.unstubAllEnvs());

    it.each(['', 'GET / HTTP/1.1\r\nHost: localhost\r\n'])(
      'closes an unfinished connection (%j) and removes signal listeners',
      async (request) => {
        const signals = ['SIGINT', 'SIGTERM'] as const;
        const listeners = signals.map((signal) => process.listeners(signal));
        let app: INestApplication | undefined;
        let socket: Socket | undefined;
        let serverSocket: Socket | undefined;
        let closing: Promise<void> | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
        try {
          app = await startApplication();
          const server = app.getHttpServer() as import('node:http').Server;
          const { port } = server.address() as AddressInfo;
          const accepted = once(server, 'connection');
          socket = createConnection({ host: '127.0.0.1', port });
          const [, connection] = await Promise.all([
            once(socket, 'connect'),
            accepted,
          ]);
          serverSocket = connection[0] as Socket;
          if (request) socket.write(request);

          if (trigger === 'close') {
            closing = app.close();
          } else {
            // Invoke the installed Nest signal handler, including a repeated
            // signal during cleanup. Prevent its final re-signal from terminating
            // the test runner; all teardown hooks and the HTTP adapter are real.
            const handler = process
              .listeners(trigger)
              .find(
                (listener) =>
                  !listeners[signals.indexOf(trigger)].includes(listener),
              );
            expect(handler).toBeDefined();
            closing = Promise.resolve(handler!(trigger));
            handler!(trigger);
          }
          const closed = await Promise.race([
            closing.then(() => true),
            new Promise<boolean>((resolve) => {
              timer = setTimeout(() => resolve(false), 1_000);
            }),
          ]);
          expect(closed).toBe(true);
          expect(database.$disconnect).toHaveBeenCalledOnce();
          if (trigger !== 'close') {
            expect(kill).toHaveBeenCalledExactlyOnceWith(process.pid, trigger);
          }
          signals.forEach((signal, index) => {
            expect(process.listeners(signal)).toEqual(listeners[index]);
          });
        } finally {
          clearTimeout(timer);
          socket?.destroy();
          serverSocket?.destroy();
          await (closing ?? app?.close());
          vi.restoreAllMocks();
        }
      },
    );
  },
);
