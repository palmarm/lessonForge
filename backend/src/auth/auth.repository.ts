import { ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import type { Principal, SafeUser } from './auth.types.js';

export type LoginUser = SafeUser & { passwordHash: string };
type Tx = Prisma.TransactionClient;
const transactionOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 5000,
  timeout: 5000,
};

// Text parameters retain PostgreSQL microseconds; JS Date is used only for responses.
async function freshTime(tx: Tx): Promise<string> {
  const [row] = await tx.$queryRaw<
    { t: string }[]
  >`SELECT clock_timestamp()::text AS t`;
  return row.t;
}
async function lockSession(tx: Tx, hash: string): Promise<string | undefined> {
  const [row] = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "Session" WHERE "tokenHash" = ${hash} FOR UPDATE`;
  return row?.id;
}
async function revokeLocked(tx: Tx, id: string, t: string): Promise<void> {
  await tx.$executeRaw`UPDATE "Session" SET "revokedAt" = GREATEST(${t}::timestamptz, "lastSeenAt") WHERE id = ${id}::uuid AND "revokedAt" IS NULL`;
}
export function tokenCollision(error: unknown): boolean {
  const e = error as {
    meta?: {
      code?: string;
      driverAdapterError?: {
        cause?: { originalCode?: string; constraint?: { index?: string } };
      };
    };
  };
  return (
    e?.meta?.driverAdapterError?.cause?.originalCode === '23505' &&
    e.meta.driverAdapterError.cause.constraint?.index ===
      'Session_tokenHash_key'
  );
}

export class AuthRepository {
  private closing = false;
  private readonly pending = new Set<Promise<unknown>>();
  constructor(readonly db: PrismaClient) {}
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing)
      throw new ServiceUnavailableException('Service unavailable.');
    const pending = operation();
    this.pending.add(pending);
    try {
      return await pending;
    } finally {
      this.pending.delete(pending);
    }
  }
  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    // AuthModule depends on PrismaModule: Nest destroys auth providers first.
    // Drain accepted queries/transactions before Prisma tears down its adapter.
    await Promise.allSettled(this.pending);
  }
  findLoginUser(email: string): Promise<LoginUser | null> {
    return this.run(() =>
      this.db.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          passwordHash: true,
        },
      }),
    );
  }
  rotate(
    user: LoginUser,
    hash: string,
    previousHash?: string,
  ): Promise<Principal | null> {
    return this.run(() =>
      this.db.$transaction(async (tx) => {
        const [current] = await tx.$queryRaw<
          LoginUser[]
        >`SELECT id, email, "displayName", role, "passwordHash" FROM "User" WHERE id = ${user.id}::uuid FOR SHARE`;
        if (!current || current.passwordHash !== user.passwordHash) return null;
        if (previousHash) {
          const id = await lockSession(tx, previousHash);
          if (id) await revokeLocked(tx, id, await freshTime(tx));
        }
        const t = await freshTime(tx);
        const [session] = await tx.$queryRaw<{ expiresAt: Date }[]>`
        INSERT INTO "Session" (id, "userId", "tokenHash", "createdAt", "lastSeenAt", "expiresAt")
        VALUES (${randomUUID()}::uuid, ${current.id}::uuid, ${hash}, ${t}::timestamptz, ${t}::timestamptz, ${t}::timestamptz + interval '8 hours') RETURNING "expiresAt"
      `;
        return {
          user: {
            id: current.id,
            email: current.email,
            displayName: current.displayName,
            role: current.role,
          },
          expiresAt: session.expiresAt,
        };
      }, transactionOptions),
    );
  }
  authenticate(hash: string): Promise<Principal | null> {
    return this.run(() =>
      this.db.$transaction(async (tx) => {
        const id = await lockSession(tx, hash);
        if (!id) return null;
        const t = await freshTime(tx);
        const [row] = await tx.$queryRaw<(SafeUser & { expiresAt: Date })[]>`
        UPDATE "Session" s SET "lastSeenAt" = GREATEST(s."lastSeenAt", ${t}::timestamptz)
        FROM "User" u WHERE s.id = ${id}::uuid AND u.id = s."userId" AND s."revokedAt" IS NULL
        AND s."expiresAt" > ${t}::timestamptz AND s."lastSeenAt" > ${t}::timestamptz - interval '30 minutes'
        RETURNING u.id, u.email, u."displayName", u.role, s."expiresAt"
      `;
        return row
          ? {
              user: {
                id: row.id,
                email: row.email,
                displayName: row.displayName,
                role: row.role,
              },
              expiresAt: row.expiresAt,
            }
          : null;
      }, transactionOptions),
    );
  }
  async revoke(hash: string): Promise<void> {
    await this.run(() =>
      this.db.$transaction(async (tx) => {
        const id = await lockSession(tx, hash);
        if (id) await revokeLocked(tx, id, await freshTime(tx));
      }, transactionOptions),
    );
  }
  cleanup(): Promise<number> {
    return this.run(() => this.cleanupBatches());
  }
  private async cleanupBatches(): Promise<number> {
    let deleted = 0;
    for (let batch = 0; batch < 10; batch++) {
      const count = await this.db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Session" WHERE "revokedAt" IS NOT NULL OR "expiresAt" <= clock_timestamp() OR "lastSeenAt" <= clock_timestamp() - interval '30 minutes'
          ORDER BY id LIMIT 1000 FOR UPDATE SKIP LOCKED
        `;
        if (!rows.length) return 0;
        const t = await freshTime(tx);
        return tx.$executeRaw`
          DELETE FROM "Session" WHERE id IN (${Prisma.join(rows.map((row) => Prisma.sql`${row.id}::uuid`))})
          AND ("revokedAt" IS NOT NULL OR "expiresAt" <= ${t}::timestamptz OR "lastSeenAt" <= ${t}::timestamptz - interval '30 minutes')
        `;
      }, transactionOptions);
      deleted += count;
      if (count === 0) break;
    }
    return deleted;
  }
}
