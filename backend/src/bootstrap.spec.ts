const app = vi.hoisted(() => ({
  enableShutdownHooks: vi.fn(),
  init: vi.fn(),
  useLogger: vi.fn(),
  listen: vi.fn(),
  close: vi.fn(),
}));
const create = vi.hoisted(() => vi.fn());
vi.mock('@nestjs/core', () => ({ NestFactory: { create } }));
vi.mock('./config/environment.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./config/environment.js')>()),
  loadBackendEnvironment: vi.fn(),
}));
import { Logger } from '@nestjs/common';
import { startApplication } from './bootstrap.js';
import { loadBackendEnvironment } from './config/environment.js';

describe('application startup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    create.mockResolvedValue(app);
    vi.spyOn(Logger, 'log').mockImplementation(() => undefined);
    vi.stubEnv('PORT', '3001');
    app.init.mockResolvedValue(undefined);
    app.listen.mockResolvedValue(undefined);
    app.close.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('loads configuration, enables signals and waits for initialization before HTTP', async () => {
    let finish!: () => void;
    app.init.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = startApplication();
    await vi.waitFor(() => expect(app.init).toHaveBeenCalledOnce());
    expect(loadBackendEnvironment).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(expect.anything(), {
      abortOnError: false,
      logger: false,
      forceCloseConnections: true,
    });
    expect(app.enableShutdownHooks).toHaveBeenCalledWith(['SIGINT', 'SIGTERM']);
    expect(app.listen).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(app.listen).toHaveBeenCalledWith(3001);
  });

  it('closes the app on initialization failure and does not listen', async () => {
    app.init.mockRejectedValue(new Error('fixture failure'));
    await expect(startApplication()).rejects.toThrow('fixture failure');
    expect(app.listen).not.toHaveBeenCalled();
    expect(app.close).toHaveBeenCalledOnce();
  });

  it('closes database providers if HTTP binding fails', async () => {
    app.listen.mockRejectedValue(new Error('fixture binding failure'));
    await expect(startApplication()).rejects.toThrow('fixture binding failure');
    expect(app.close).toHaveBeenCalledOnce();
  });

  it('rejects invalid PORT before constructing providers', async () => {
    vi.stubEnv('PORT', 'private-invalid-port');
    await expect(startApplication()).rejects.toThrow('PORT must be');
    expect(create).not.toHaveBeenCalled();
  });

  it('waits for cleanup before reporting a startup failure', async () => {
    const failure = new Error('fixture binding failure');
    app.listen.mockRejectedValue(failure);
    let finish!: () => void;
    app.close.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const rejected = vi.fn();
    const pending = startApplication().catch(rejected);
    await vi.waitFor(() => expect(app.close).toHaveBeenCalledOnce());
    expect(rejected).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(rejected).toHaveBeenCalledWith(failure);
  });
});
