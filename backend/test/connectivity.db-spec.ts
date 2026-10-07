import { loadBackendEnvironment } from '../src/config/environment.js';
import {
  assertLocalDevelopmentDatabase,
  resolveDatabaseUrl,
} from '../src/config/database.js';
import {
  createDatabaseClient,
  PrismaService,
} from '../src/prisma/prisma.service.js';

it('verifies SELECT 1 against the local LessonForge development database', async () => {
  loadBackendEnvironment();
  const url = resolveDatabaseUrl(process.env.DATABASE_URL);
  // Check before constructing a client; never contact any other database.
  assertLocalDevelopmentDatabase(url);
  const service = new PrismaService(createDatabaseClient(url));
  try {
    await service.onModuleInit();
  } finally {
    await service.onModuleDestroy();
  }
});
