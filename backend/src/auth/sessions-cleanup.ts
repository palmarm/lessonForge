import { loadBackendEnvironment } from '../config/environment.js';
import { resolveDatabaseUrl } from '../config/database.js';
import { createDatabaseClient } from '../prisma/prisma.service.js';
import { AuthRepository } from './auth.repository.js';

// Explicit maintenance entrypoint only: never imported by application startup.
async function main(): Promise<void> {
  loadBackendEnvironment();
  const db = createDatabaseClient(resolveDatabaseUrl(process.env.DATABASE_URL));
  try {
    const count = await new AuthRepository(db).cleanup();
    console.log(`Deleted ${count} invalid session records (maximum 10000).`);
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error(
    'Session cleanup failed. Check backend configuration and database readiness.',
  );
  process.exitCode = 1;
});
