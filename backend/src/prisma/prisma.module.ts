import { Module } from '@nestjs/common';
import { loadBackendEnvironment } from '../config/environment.js';
import { resolveDatabaseUrl } from '../config/database.js';
import { createDatabaseClient, PrismaService } from './prisma.service.js';

@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: () => {
        loadBackendEnvironment();
        return new PrismaService(
          createDatabaseClient(resolveDatabaseUrl(process.env.DATABASE_URL)),
        );
      },
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
