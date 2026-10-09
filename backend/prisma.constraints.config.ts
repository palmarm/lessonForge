import { defineConfig } from 'prisma/config';
import { resolveConstraintDatabaseUrl } from './test/support/constraint-database.js';

// Dedicated to disposable constraint verification: no real environment loading.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: resolveConstraintDatabaseUrl(
      process.env.CONSTRAINT_TEST_DATABASE_URL,
      process.env.LESSONFORGE_CONSTRAINT_TEST,
    ),
  },
});
