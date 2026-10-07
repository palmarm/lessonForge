import { startApplication } from './bootstrap.js';
import { ConfigurationError } from './config/environment.js';
import { DatabaseConnectionError } from './prisma/prisma.service.js';

try {
  await startApplication();
} catch (error) {
  console.error(
    error instanceof ConfigurationError ||
      error instanceof DatabaseConnectionError
      ? error.message
      : 'LessonForge API startup failed. Check backend configuration and port availability.',
  );
  process.exitCode = 1;
}
