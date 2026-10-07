import { defineConfig } from 'prisma/config';
import { loadBackendEnvironment } from './src/config/environment.js';

loadBackendEnvironment();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // Generation and validation do not need credentials or a running database.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
