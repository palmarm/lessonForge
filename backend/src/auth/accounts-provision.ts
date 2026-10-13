import { loadBackendEnvironment } from '../config/environment.js';
import { createDatabaseClient } from '../prisma/prisma.service.js';
import { PasswordService } from './password.service.js';
import { TerminalAccountPrompts } from './accounts.terminal.js';
import { runProvisioningCli } from './accounts.provision-cli.js';

// Explicit compiled entrypoint only. Startup, build, and tests never import it.
const cancellation = new AbortController();
const cancel = () => cancellation.abort();
process.on('SIGINT', cancel);
process.on('SIGTERM', cancel);
try {
  process.exitCode = await runProvisioningCli({
    args: process.argv.slice(2),
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    signal: cancellation.signal,
    loadEnvironment: loadBackendEnvironment,
    databaseUrl: () => process.env.DATABASE_URL,
    createClient: createDatabaseClient,
    createPasswords: () => new PasswordService(),
    createPrompts: () =>
      new TerminalAccountPrompts(
        process.stdin,
        process.stdout,
        cancellation.signal,
        cancel,
      ),
    write: (message) => console.log(message),
  });
} finally {
  process.removeListener('SIGINT', cancel);
  process.removeListener('SIGTERM', cancel);
}
