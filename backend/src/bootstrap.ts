import { NestFactory } from '@nestjs/core';
import { Logger, type INestApplication } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { loadBackendEnvironment } from './config/environment.js';
import { resolvePort } from './port.js';

export async function startApplication(): Promise<INestApplication> {
  loadBackendEnvironment();
  const port = resolvePort(process.env.PORT);
  let app: INestApplication | undefined;
  try {
    // Disable framework error logging until config and connectivity are verified.
    app = await NestFactory.create(AppModule, {
      abortOnError: false,
      logger: false,
      // Unfinished HTTP requests must not keep signal shutdown waiting after
      // the database has disconnected. The adapter closes its tracked sockets.
      forceCloseConnections: true,
    });
    app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
    await app.init();
    app.useLogger(['log', 'warn', 'error']);
    Logger.log('Database connectivity verified.', 'LessonForge');
    await app.listen(port);
    return app;
  } catch (error) {
    await app?.close().catch(() => undefined);
    throw error;
  }
}
