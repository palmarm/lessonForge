import {
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export class DatabaseConnectionError extends Error {}

export function databaseFailureMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined;
  const reason =
    code === '28P01' || code === 'P1000'
      ? 'authentication failed'
      : code === 'ECONNREFUSED' || code === 'P1001'
        ? 'server unavailable'
        : code === 'ETIMEDOUT' || code === '57014' || code === 'P1002'
          ? 'operation timed out'
          : 'connection or query failed';
  return `Database ${reason}. Check PostgreSQL readiness and backend DATABASE_URL configuration.`;
}

export function createDatabaseClient(connectionString: string): PrismaClient {
  const logger = new Logger(PrismaService.name);
  const adapter = new PrismaPg(
    {
      connectionString,
      max: 5,
      connectionTimeoutMillis: 5_000,
      query_timeout: 5_000,
      statement_timeout: 5_000,
    },
    {
      onPoolError: (error) => logger.error(databaseFailureMessage(error)),
      onConnectionError: (error) => logger.error(databaseFailureMessage(error)),
    },
  );
  // Disable Prisma's own error logs; driver text can contain credentials.
  return new PrismaClient({ adapter, log: [] });
}

export type DatabaseClient = Pick<
  PrismaClient,
  '$connect' | '$disconnect' | '$queryRaw'
>;

export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private disconnecting?: Promise<void>;
  private closing = false;

  constructor(readonly client: DatabaseClient) {}

  async onModuleInit(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.verifyConnectivity(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject({ code: 'ETIMEDOUT' }), 12_000);
        }),
      ]);
      this.logger.log('Database connectivity verified.');
    } catch (error) {
      try {
        await this.onModuleDestroy();
      } catch {
        this.logger.error(
          'Database cleanup failed after initialization failure.',
        );
      }
      throw new DatabaseConnectionError(databaseFailureMessage(error));
    } finally {
      clearTimeout(timer);
    }
  }

  private async verifyConnectivity(): Promise<void> {
    await this.client.$connect();
    // A connect that finishes after the deadline must not start another query.
    if (this.closing)
      throw new Error('Database initialization already stopped');
    // Driver deadlines bound the underlying operations as well as the caller.
    const rows = await this.client.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
    if (rows.length !== 1 || rows[0]?.ok !== 1)
      throw new Error('Unexpected connectivity result');
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    this.disconnecting ??= this.client.$disconnect();
    try {
      await this.disconnecting;
    } catch {
      throw new DatabaseConnectionError('Database connection cleanup failed.');
    }
  }
}
