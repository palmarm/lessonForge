import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import type { PasswordService } from './password.service.js';
import {
  accountTargets,
  assertNotCancelled,
  provisioningPassword,
  ProvisioningError,
  type AccountCredentials,
  type AccountTarget,
} from './accounts.input.js';

type ExistingAccount = Pick<AccountTarget, 'email' | 'displayName' | 'role'> & {
  id: string;
};
function matching(target: AccountTarget, existing?: ExistingAccount): void {
  if (
    existing &&
    (existing.role !== target.role ||
      existing.displayName !== target.displayName)
  )
    throw new ProvisioningError(
      'An existing account has a different role or display name. No accounts were provisioned.',
    );
}

// The caller supplies an already authorized client. This service never loads configuration.
export class AccountsService {
  constructor(
    private readonly db: PrismaClient,
    private readonly passwords: Pick<PasswordService, 'hash'>,
  ) {}

  async inspect(input: unknown) {
    const targets = accountTargets(input);
    const existing = await this.db.user.findMany({
      where: { email: { in: targets.map((target) => target.email) } },
      select: { id: true, email: true, displayName: true, role: true },
    });
    return targets.map((target) => {
      const row = existing.find((account) => account.email === target.email);
      matching(target, row);
      return { ...target, exists: row !== undefined };
    });
  }

  async provision(
    input: unknown,
    credentials: AccountCredentials,
    signal?: AbortSignal,
  ) {
    assertNotCancelled(signal);
    const targets = await this.inspect(input);
    assertNotCancelled(signal);
    const hashes = new Map<string, string>();
    // Validate every needed password before starting native work. Never hash a rerun.
    const missing = targets.filter((target) => !target.exists);
    const passwords = missing.map((target) =>
      provisioningPassword(credentials[target.key]),
    );
    for (const [index, target] of missing.entries()) {
      assertNotCancelled(signal);
      hashes.set(target.email, await this.passwords.hash(passwords[index]));
    }
    assertNotCancelled(signal);
    try {
      return await this.db.$transaction(
        async (tx) => {
          const existing = await tx.$queryRaw<ExistingAccount[]>`
          SELECT id, email, "displayName", role FROM "User"
          WHERE email IN (${Prisma.join(targets.map((target) => target.email))})
          ORDER BY email FOR SHARE
        `;
          assertNotCancelled(signal);
          for (const target of targets)
            matching(
              target,
              existing.find((account) => account.email === target.email),
            );
          const results: {
            key: AccountTarget['key'];
            status: 'created' | 'unchanged';
          }[] = [];
          for (const target of targets) {
            assertNotCancelled(signal);
            if (existing.some((account) => account.email === target.email)) {
              results.push({ key: target.key, status: 'unchanged' });
              continue;
            }
            const passwordHash = hashes.get(target.email);
            if (!passwordHash)
              throw new ProvisioningError(
                'Accounts changed during provisioning. No accounts were provisioned; rerun the command.',
              );
            // A unique-email race aborts the entire transaction; no upsert or retry writes.
            await tx.user.create({
              data: {
                email: target.email,
                displayName: target.displayName,
                role: target.role,
                passwordHash,
              },
            });
            results.push({ key: target.key, status: 'created' });
          }
          assertNotCancelled(signal);
          return results;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 5000,
          timeout: 5000,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ProvisioningError(
          'An account was inserted concurrently. No accounts were provisioned; rerun the command.',
        );
      throw error;
    }
  }
}
