import type { PrismaClient } from '../generated/prisma/client.js';
import type { PasswordService } from './password.service.js';
import type { AccountPrompts } from './accounts.terminal.js';
import { AccountsService } from './accounts.service.js';
import {
  accountTargets,
  assertNotCancelled,
  provisioningPassword,
  ProvisioningCancelled,
  ProvisioningError,
  resolveProvisioningDatabaseUrl,
  type AccountCredentials,
} from './accounts.input.js';

export type ProvisioningCliOptions = {
  args: readonly string[];
  interactive: boolean;
  signal: AbortSignal;
  loadEnvironment: () => void;
  databaseUrl: () => string | undefined;
  createClient: (url: string) => PrismaClient;
  createPasswords: () => Pick<PasswordService, 'hash' | 'onModuleDestroy'>;
  createPrompts: () => AccountPrompts;
  write: (message: string) => void;
};

export async function runProvisioningCli(
  options: ProvisioningCliOptions,
): Promise<number> {
  let prompts: AccountPrompts | undefined;
  let db: PrismaClient | undefined;
  let passwords:
    ReturnType<ProvisioningCliOptions['createPasswords']> | undefined;
  let exitCode = 0;
  try {
    if (options.args.length || !options.interactive)
      throw new ProvisioningError(
        'Provisioning requires an interactive terminal and accepts no arguments.',
      );
    assertNotCancelled(options.signal);
    options.loadEnvironment();
    const url = resolveProvisioningDatabaseUrl(options.databaseUrl());
    prompts = options.createPrompts();
    options.write(
      'Target: 127.0.0.1:5433/lessonforge_dev. This command creates only the supplied missing accounts.',
    );
    if (
      (await prompts.ask('Type provision lessonforge_dev to continue')) !==
      'provision lessonforge_dev'
    )
      throw new ProvisioningCancelled();
    const input = {
      teacher: {
        email: await prompts.ask('Teacher email'),
        displayName: await prompts.ask('Teacher display name'),
      },
      admin: {
        email: await prompts.ask('Administrator email'),
        displayName: await prompts.ask('Administrator display name'),
      },
    };
    accountTargets(input);
    assertNotCancelled(options.signal);
    db = options.createClient(url);
    const identity = await db.$queryRaw<
      { database: string }[]
    >`SELECT current_database() AS database`;
    if (identity.length !== 1 || identity[0].database !== 'lessonforge_dev')
      throw new ProvisioningError(
        'Connected database identity does not match the acknowledged target.',
      );
    assertNotCancelled(options.signal);
    passwords = options.createPasswords();
    const service = new AccountsService(db, passwords);
    const accounts = await service.inspect(input);
    assertNotCancelled(options.signal);
    const credentials: AccountCredentials = {};
    for (const account of accounts) {
      assertNotCancelled(options.signal);
      if (account.exists) continue;
      const label = account.key === 'teacher' ? 'Teacher' : 'Administrator';
      const password = provisioningPassword(
        await prompts.ask(`${label} password`, true),
      );
      const confirmation = await prompts.ask(
        `${label} password confirmation`,
        true,
      );
      if (password !== confirmation)
        throw new ProvisioningError(
          'Password confirmation does not match. No accounts were provisioned.',
        );
      credentials[account.key] = password;
    }
    const results = await service.provision(input, credentials, options.signal);
    for (const result of results)
      options.write(
        `${result.key === 'teacher' ? 'Teacher' : 'Administrator'} account: ${result.status}.`,
      );
  } catch (error) {
    exitCode = 1;
    options.write(
      error instanceof ProvisioningCancelled
        ? 'Account provisioning cancelled.'
        : error instanceof ProvisioningError
          ? error.message
          : 'Account provisioning failed. Check backend configuration and database readiness; rerun to confirm account state.',
    );
  } finally {
    // Restore the terminal first, then drain native work and disconnect even if
    // another cleanup fails. A signal never forces process exit mid-transaction.
    const cleanup = await Promise.allSettled([
      Promise.resolve().then(() => prompts?.close()),
      Promise.resolve().then(() => passwords?.onModuleDestroy()),
      Promise.resolve().then(() => db?.$disconnect()),
    ]);
    if (cleanup.some((result) => result.status === 'rejected')) {
      options.write(
        'Account provisioning cleanup failed. Check terminal and database readiness.',
      );
      exitCode = 1;
    }
  }
  return exitCode;
}
