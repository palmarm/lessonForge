import { PassThrough, Writable } from 'node:stream';
import type { ReadStream, WriteStream } from 'node:tty';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  accountTargets,
  provisioningPassword,
  resolveProvisioningDatabaseUrl,
  ProvisioningCancelled,
} from './accounts.input.js';
import { AccountsService } from './accounts.service.js';
import {
  runProvisioningCli,
  type ProvisioningCliOptions,
} from './accounts.provision-cli.js';
import { TerminalAccountPrompts } from './accounts.terminal.js';

const details = {
  teacher: { email: ' Teacher@Example.test ', displayName: ' Teacher ' },
  admin: { email: 'admin@example.test', displayName: 'Administrator' },
};
const password = ' Unicode 🔒 password ';
const url = 'postgresql://fixture:fixture@127.0.0.1:5433/lessonforge_dev';

it.each([
  undefined,
  '',
  'postgresql://secret:secret@localhost:5433/lessonforge_dev',
  'postgresql://secret:secret@127.0.0.1:5434/lessonforge_dev',
  'postgresql://secret:secret@127.0.0.1:5433/other',
  `${url}?sslmode=disable`,
  `${url}?`,
  `${url}#fragment`,
  'postgresql://fixture@127.0.0.1:5433/lessonforge_dev',
  'postgresql://fixture:%ZZ@127.0.0.1:5433/lessonforge_dev',
])(
  'refuses unsafe provisioning targets without exposing the supplied URL (%#)',
  (value) => {
    expect(() => resolveProvisioningDatabaseUrl(value)).toThrow(
      'Provisioning requires 127.0.0.1:5433/lessonforge_dev without URL query parameters.',
    );
  },
);
it('accepts only the configured local development target', () => {
  expect(resolveProvisioningDatabaseUrl(url)).toBe(url);
});
it.each([
  null,
  [],
  {},
  { ...details, teacher: null },
  { ...details, teacher: { email: 'bad', displayName: 'Teacher' } },
  { ...details, teacher: { email: 'é@example.test', displayName: 'Teacher' } },
  {
    ...details,
    teacher: { email: 'teacher@example.test', displayName: ' \t ' },
  },
  {
    ...details,
    teacher: { email: 'teacher@example.test', displayName: '🔒'.repeat(81) },
  },
  {
    ...details,
    admin: { email: 'TEACHER@example.test', displayName: 'Administrator' },
  },
])('rejects invalid or duplicate account details (%#)', (value) => {
  expect(() => accountTargets(value)).toThrow('Supply valid, distinct');
});
it('canonicalizes emails, trims names, assigns roles, and accepts Unicode name boundaries', () => {
  expect(accountTargets(details)[0]).toEqual({
    key: 'teacher',
    email: 'teacher@example.test',
    displayName: 'Teacher',
    role: 'TEACHER',
  });
  expect(
    accountTargets({
      ...details,
      admin: { ...details.admin, displayName: '🔒'.repeat(80) },
    })[1].displayName,
  ).toBe('🔒'.repeat(80));
});
it.each([
  undefined,
  1,
  '',
  'x'.repeat(14),
  'x'.repeat(129),
  'x'.repeat(15) + '\0',
])('rejects invalid provisioning passwords (%#)', (value) => {
  expect(() => provisioningPassword(value)).toThrow('Passwords require');
});
it('preserves password whitespace/Unicode and accepts both length boundaries', () => {
  expect(provisioningPassword(password)).toBe(password);
  expect(provisioningPassword('x'.repeat(15))).toHaveLength(15);
  expect(provisioningPassword('🔒'.repeat(128))).toBe('🔒'.repeat(128));
});

function fixture(
  answers = [
    'provision lessonforge_dev',
    details.teacher.email,
    details.teacher.displayName,
    details.admin.email,
    details.admin.displayName,
    password,
    password,
    password,
    password,
  ],
) {
  const cancellation = new AbortController();
  const findMany = vi.fn().mockResolvedValue([]);
  const create = vi.fn().mockResolvedValue({});
  const tx = { $queryRaw: vi.fn().mockResolvedValue([]), user: { create } };
  const db = {
    user: { findMany },
    $queryRaw: vi.fn().mockResolvedValue([{ database: 'lessonforge_dev' }]),
    $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) =>
      work(tx),
    ),
    $disconnect: vi.fn().mockResolvedValue(undefined),
  };
  const passwords = {
    hash: vi.fn().mockResolvedValue('fixture-hash'),
    onModuleDestroy: vi.fn().mockResolvedValue(undefined),
  };
  const prompts = {
    ask: vi.fn(async () => answers.shift() ?? ''),
    close: vi.fn(),
  };
  const options: ProvisioningCliOptions = {
    args: [],
    interactive: true,
    signal: cancellation.signal,
    loadEnvironment: vi.fn(),
    databaseUrl: () => url,
    createClient: vi.fn(() => db as unknown as PrismaClient),
    createPasswords: vi.fn(() => passwords),
    createPrompts: vi.fn(() => prompts),
    write: vi.fn(),
  };
  return { options, db, passwords, prompts, cancellation, tx };
}
it.each([
  'arguments',
  'noninteractive',
  'aborted',
  'target',
  'acknowledgement',
  'details',
])('rejects %s before constructing a database client', async (kind) => {
  const f = fixture();
  if (kind === 'arguments') f.options.args = ['--password=must-not-log'];
  if (kind === 'noninteractive') f.options.interactive = false;
  if (kind === 'aborted') f.cancellation.abort();
  if (kind === 'target')
    f.options.databaseUrl = () =>
      'postgresql://secret:secret@other:5433/lessonforge_dev';
  if (kind === 'acknowledgement') f.prompts.ask.mockResolvedValue('no');
  if (kind === 'details')
    f.prompts.ask.mockImplementation(async () =>
      f.prompts.ask.mock.calls.length === 1 ? 'provision lessonforge_dev' : '',
    );
  expect(await runProvisioningCli(f.options)).toBe(1);
  expect(f.options.createClient).not.toHaveBeenCalled();
  const messages = JSON.stringify(
    (f.options.write as ReturnType<typeof vi.fn>).mock.calls,
  );
  expect(messages).not.toContain('secret');
  expect(messages).not.toContain('must-not-log');
});
it('creates explicitly assigned accounts, masks both password prompts, and cleans up', async () => {
  const f = fixture();
  expect(await runProvisioningCli(f.options)).toBe(0);
  expect(f.db.$transaction).toHaveBeenCalledOnce();
  expect(f.tx.user.create).toHaveBeenCalledTimes(2);
  expect(
    f.prompts.ask.mock.calls.filter((call: unknown[]) => call[1] === true),
  ).toHaveLength(4);
  expect(f.passwords.hash).toHaveBeenCalledWith(password);
  expect(f.prompts.close).toHaveBeenCalledOnce();
  expect(f.passwords.onModuleDestroy).toHaveBeenCalledOnce();
  expect(f.db.$disconnect).toHaveBeenCalledOnce();
  expect(
    JSON.stringify((f.options.write as ReturnType<typeof vi.fn>).mock.calls),
  ).not.toContain(password);
});
it('skips password prompts, hashing, and all account writes on a matching rerun', async () => {
  const f = fixture();
  const rows = accountTargets(details).map((target, index) => ({
    ...target,
    id: `id-${index}`,
  }));
  f.db.user.findMany.mockResolvedValue(rows);
  f.tx.$queryRaw.mockResolvedValue(rows);
  expect(await runProvisioningCli(f.options)).toBe(0);
  expect(f.prompts.ask).toHaveBeenCalledTimes(5);
  expect(f.passwords.hash).not.toHaveBeenCalled();
  expect(f.tx.user.create).not.toHaveBeenCalled();
  expect(f.options.write).toHaveBeenCalledWith('Teacher account: unchanged.');
});
it.each([
  'conflict',
  'confirmation',
  'password',
  'cancel',
  'database',
  'identity',
])('fails safely on %s and disconnects', async (kind) => {
  const f = fixture();
  if (kind === 'conflict')
    f.db.user.findMany.mockResolvedValue([
      {
        id: 'id',
        email: 'teacher@example.test',
        displayName: 'Teacher',
        role: 'ADMIN',
      },
    ]);
  if (kind === 'confirmation')
    f.prompts.ask.mockImplementation(async () =>
      f.prompts.ask.mock.calls.length <= 5
        ? [
            'provision lessonforge_dev',
            details.teacher.email,
            'Teacher',
            details.admin.email,
            'Administrator',
          ][f.prompts.ask.mock.calls.length - 1]
        : f.prompts.ask.mock.calls.length === 6
          ? password
          : 'different',
    );
  if (kind === 'password')
    f.prompts.ask.mockImplementation(
      async () =>
        [
          'provision lessonforge_dev',
          details.teacher.email,
          'Teacher',
          details.admin.email,
          'Administrator',
          'short',
        ][f.prompts.ask.mock.calls.length - 1],
    );
  if (kind === 'cancel')
    f.prompts.ask.mockImplementation(async () => {
      if (f.prompts.ask.mock.calls.length === 6)
        throw new ProvisioningCancelled();
      return [
        'provision lessonforge_dev',
        details.teacher.email,
        'Teacher',
        details.admin.email,
        'Administrator',
      ][f.prompts.ask.mock.calls.length - 1];
    });
  if (kind === 'database')
    f.db.user.findMany.mockRejectedValue(
      new Error('postgresql://secret:secret@private'),
    );
  if (kind === 'identity')
    f.db.$queryRaw.mockResolvedValue([{ database: 'other' }]);
  expect(await runProvisioningCli(f.options)).toBe(1);
  expect(f.tx.user.create).not.toHaveBeenCalled();
  expect(f.passwords.hash).not.toHaveBeenCalled();
  expect(f.prompts.close).toHaveBeenCalledOnce();
  expect(f.db.$disconnect).toHaveBeenCalledOnce();
  expect(
    JSON.stringify((f.options.write as ReturnType<typeof vi.fn>).mock.calls),
  ).not.toContain('secret');
});
it('cancellation during native hashing prevents the transaction', async () => {
  const f = fixture();
  f.passwords.hash.mockImplementation(async () => {
    f.cancellation.abort();
    return 'fixture-hash';
  });
  const service = new AccountsService(
    f.db as unknown as PrismaClient,
    f.passwords,
  );
  await expect(
    service.provision(
      details,
      { teacher: password, admin: password },
      f.cancellation.signal,
    ),
  ).rejects.toBeInstanceOf(ProvisioningCancelled);
  expect(f.db.$transaction).not.toHaveBeenCalled();
});
it('validates every missing password before hashing or beginning a transaction', async () => {
  const f = fixture();
  const service = new AccountsService(
    f.db as unknown as PrismaClient,
    f.passwords,
  );
  await expect(
    service.provision(details, { teacher: password, admin: 'short' }),
  ).rejects.toThrow('Passwords require');
  expect(f.passwords.hash).not.toHaveBeenCalled();
  expect(f.db.$transaction).not.toHaveBeenCalled();
});
it('cancellation during account lookup skips passwords and still disconnects', async () => {
  const f = fixture();
  f.db.user.findMany.mockImplementation(async () => {
    f.cancellation.abort();
    return [];
  });
  expect(await runProvisioningCli(f.options)).toBe(1);
  expect(f.prompts.ask).toHaveBeenCalledTimes(5);
  expect(f.passwords.hash).not.toHaveBeenCalled();
  expect(f.db.$transaction).not.toHaveBeenCalled();
  expect(f.db.$disconnect).toHaveBeenCalledOnce();
});
it('native hashing failures produce sanitized errors and clean up without a transaction', async () => {
  const f = fixture();
  f.passwords.hash.mockRejectedValue(new Error('private-fixture-secret'));
  expect(await runProvisioningCli(f.options)).toBe(1);
  expect(f.db.$transaction).not.toHaveBeenCalled();
  expect(f.passwords.onModuleDestroy).toHaveBeenCalledOnce();
  expect(f.db.$disconnect).toHaveBeenCalledOnce();
  expect(
    JSON.stringify((f.options.write as ReturnType<typeof vi.fn>).mock.calls),
  ).not.toContain('private-fixture-secret');
});
it('cleanup still drains passwords and disconnects when terminal restoration fails', async () => {
  const f = fixture();
  f.prompts.close.mockImplementation(() => {
    throw new Error('private');
  });
  expect(await runProvisioningCli(f.options)).toBe(1);
  expect(f.passwords.onModuleDestroy).toHaveBeenCalledOnce();
  expect(f.db.$disconnect).toHaveBeenCalledOnce();
});
it('sanitizes transaction and disconnect failures', async () => {
  const f = fixture();
  f.db.$transaction.mockRejectedValue(new Error('private-credential'));
  f.db.$disconnect.mockRejectedValue(new Error('private-credential'));
  expect(await runProvisioningCli(f.options)).toBe(1);
  expect(
    JSON.stringify((f.options.write as ReturnType<typeof vi.fn>).mock.calls),
  ).not.toContain('private-credential');
});

function terminal(wasRaw = false) {
  const input = new PassThrough() as PassThrough & {
    isTTY: boolean;
    isRaw: boolean;
    setRawMode: ReturnType<typeof vi.fn>;
  };
  input.isTTY = true;
  input.isRaw = wasRaw;
  input.setRawMode = vi.fn((raw: boolean) => {
    input.isRaw = raw;
    return input;
  });
  let text = '';
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  const cancellation = new AbortController();
  const prompts = new TerminalAccountPrompts(
    input as unknown as ReadStream,
    output as WriteStream,
    cancellation.signal,
    () => cancellation.abort(),
  );
  return { input, output, prompts, cancellation, text: () => text };
}
it('hides typed/pasted passwords and confirmation, including redraws and backspace', async () => {
  const f = terminal();
  try {
    const first = f.prompts.ask('Password', true);
    f.input.write(`${password}x\x7f\r`);
    expect(await first).toBe(password);
    const second = f.prompts.ask('Confirmation', true);
    f.input.write(`${password}\r`);
    expect(await second).toBe(password);
    expect(f.text()).toContain('[input hidden]');
    expect(f.text()).not.toContain(password);
    expect(f.text()).not.toContain('Unicode');
  } finally {
    f.prompts.close();
  }
  expect(f.input.isRaw).toBe(false);
});
it('isolates password cut/yank state from confirmation, idle input, and later visible prompts', async () => {
  const f = terminal();
  try {
    const first = f.prompts.ask('Password', true);
    f.input.write(`${password}\x15\x19\r`);
    expect(await first).toBe(password);
    const confirmation = f.prompts.ask('Confirmation', true);
    // A new editor has no password to yank; independently enter and edit it.
    f.input.write(`\x19${password}\x15\x19\r`);
    expect(await confirmation).toBe(password);
    const beforeIdleInput = f.text();
    f.input.write('\x19idle text\x15\x19\x1b[A\x1b[D\x7f\t\r');
    expect(f.text()).toBe(beforeIdleInput);
    const visible = f.prompts.ask('Visible answer');
    f.input.write('\x19\x1f\x1b[Aaccepted\rvisible-tail');
    expect(await visible).toBe('accepted');
    expect(f.text()).toContain('accepted');
    expect(f.text()).not.toContain(password);
    expect(f.text()).not.toContain('Unicode');
    expect(f.text()).not.toContain('idle text');
    expect(f.text()).not.toContain('visible-tail');
  } finally {
    f.prompts.close();
  }
  expect(f.input.isRaw).toBe(false);
});

it.each([false, true])(
  'keeps raw mode continuous across editor replacement and restores prior raw mode (%s)',
  async (wasRaw) => {
    const f = terminal(wasRaw);
    try {
      for (let index = 0; index < 30; index++) {
        const answer = f.prompts.ask('Password', true);
        f.input.write(`${password}\x15\x19\r`);
        expect(await answer).toBe(password);
        expect(f.input.isRaw).toBe(true);
        expect(f.input.setRawMode.mock.calls).toEqual([[true]]);
        // Only the owner's stable pipe is attached to the actual terminal.
        expect(f.input.listenerCount('data')).toBe(1);
        expect(f.input.listenerCount('keypress')).toBe(0);
      }
      expect(f.text()).not.toContain(password);
      expect(f.text()).not.toContain('Unicode');
    } finally {
      f.prompts.close();
      f.prompts.close();
    }
    expect(f.input.setRawMode.mock.calls).toEqual([[true], [wasRaw]]);
    expect(f.input.isRaw).toBe(wasRaw);
    expect(f.input.listenerCount('data')).toBe(0);
    expect(f.input.listenerCount('end')).toBe(0);
    expect(f.input.listenerCount('error')).toBe(0);
  },
);

it.each([
  'success',
  'interrupt',
  'eof',
  'signal',
  'input-error',
  'output-error',
])(
  'keeps real terminal input hidden and cancellation live during held provisioning (%s)',
  async (kind) => {
    const f = fixture();
    const t = terminal();
    f.options.signal = t.cancellation.signal;
    f.options.createPrompts = () => t.prompts;
    let releaseHash!: (value: string) => void;
    f.passwords.hash.mockImplementationOnce(
      () => new Promise<string>((resolve) => (releaseHash = resolve)),
    );
    const pending = runProvisioningCli(f.options);
    try {
      for (const [label, answer] of [
        [
          'Type provision lessonforge_dev to continue',
          'provision lessonforge_dev',
        ],
        ['Teacher email', details.teacher.email],
        ['Teacher display name', details.teacher.displayName],
        ['Administrator email', details.admin.email],
        ['Administrator display name', details.admin.displayName],
        ['Teacher password [input hidden]', `${password}\x15\x19`],
        ['Teacher password confirmation [input hidden]', password],
        ['Administrator password [input hidden]', `${password}\x15\x19`],
        ['Administrator password confirmation [input hidden]', password],
      ]) {
        await vi.waitFor(() => expect(t.text()).toContain(`${label}: `));
        t.input.write(`${answer}\r`);
      }
      await vi.waitFor(() => expect(f.passwords.hash).toHaveBeenCalledTimes(1));
      const beforeIdleInput = t.text();
      t.input.write('\x19pending input\x15\x19\x1b[A\x1b[D\x7f\t\r');
      expect(t.text()).toBe(beforeIdleInput);
      expect(f.db.$transaction).not.toHaveBeenCalled();
      expect(t.input.isRaw).toBe(true);
      if (kind === 'interrupt') t.input.write('\x03');
      if (kind === 'eof') t.input.write('\x04');
      if (kind === 'signal') t.cancellation.abort();
      if (kind === 'input-error')
        t.input.emit('error', new Error('Fixture input failure'));
      if (kind === 'output-error')
        t.output.emit('error', new Error('Fixture output failure'));
      if (kind !== 'success') {
        expect(t.cancellation.signal.aborted).toBe(true);
        expect(t.input.isRaw).toBe(false);
      }
      releaseHash('fixture-hash');
      expect(await pending).toBe(kind === 'success' ? 0 : 1);
      expect(f.tx.user.create).toHaveBeenCalledTimes(
        kind === 'success' ? 2 : 0,
      );
      expect(f.passwords.hash).toHaveBeenNthCalledWith(1, password);
      expect(f.passwords.onModuleDestroy).toHaveBeenCalledOnce();
      expect(f.db.$disconnect).toHaveBeenCalledOnce();
      expect(t.input.isRaw).toBe(false);
      expect(t.text()).not.toContain(password);
      expect(t.text()).not.toContain('Unicode');
      expect(
        JSON.stringify(
          (f.options.write as ReturnType<typeof vi.fn>).mock.calls,
        ),
      ).not.toContain(password);
    } finally {
      t.cancellation.abort();
      releaseHash?.('fixture-hash');
      await pending;
      t.prompts.close();
    }
  },
);
it.each(['interrupt', 'eof', 'signal', 'input-error'])(
  'cancels hidden prompts on %s and restores terminal mode',
  async (kind) => {
    const f = terminal();
    const answer = f.prompts.ask('Password', true);
    const rejection = expect(answer).rejects.toBeInstanceOf(
      ProvisioningCancelled,
    );
    f.input.write('secret-must-not-echo');
    if (kind === 'interrupt') f.input.write('\x03');
    if (kind === 'eof') f.input.end();
    if (kind === 'signal') f.cancellation.abort();
    if (kind === 'input-error')
      f.input.emit('error', new Error('Fixture input failure'));
    await rejection;
    f.prompts.close();
    expect(f.cancellation.signal.aborted).toBe(true);
    expect(f.input.isRaw).toBe(false);
    expect(f.text()).not.toContain('secret-must-not-echo');
  },
);
it('restores a preexisting raw mode and closes idempotently', () => {
  const f = terminal(true);
  f.prompts.close();
  f.prompts.close();
  expect(f.input.isRaw).toBe(true);
});
