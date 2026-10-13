// Fixture-only compiled probe. Never import the provisioning entrypoint or load
// environment configuration. Run through provisioning.terminal-pty.py after build.
import assert from 'node:assert/strict';
import { TerminalAccountPrompts } from '../dist/auth/accounts.terminal.js';
import { ProvisioningCancelled } from '../dist/auth/accounts.input.js';

const mode = process.argv[2];
const fixture = ' Unicode 🔒 fixture-pressure-password ';
const cancellation = new AbortController();
const cancel = () => cancellation.abort();
const modeChanges = [];
const setRawMode = process.stdin.setRawMode.bind(process.stdin);
process.stdin.setRawMode = (raw) => {
  modeChanges.push(raw);
  return setRawMode(raw);
};
const terminate = cancel;
const inputError = () =>
  process.stdin.emit('error', new Error('Fixture input failure'));
const outputError = () =>
  process.stdout.emit('error', new Error('Fixture output failure'));
process.on('SIGTERM', terminate);
process.on('SIGUSR2', inputError);
process.on('SIGHUP', outputError);
const prompts = new TerminalAccountPrompts(
  process.stdin,
  process.stdout,
  cancellation.signal,
  cancel,
);

async function heldWork() {
  let release;
  const aborted = () => release.reject(new ProvisioningCancelled());
  const released = () => release.resolve();
  try {
    const pending = new Promise((resolve, reject) => {
      release = { resolve, reject };
      process.once('SIGUSR1', released);
      cancellation.signal.addEventListener('abort', aborted, { once: true });
    });
    process.stdout.write('READY_PENDING\n');
    await pending;
  } finally {
    process.removeListener('SIGUSR1', released);
    cancellation.signal.removeEventListener('abort', aborted);
  }
}

try {
  if (mode === 'pressure') {
    for (let index = 0; index < 500; index++) {
      await prompts.ask('Pressure password', true);
      assert.deepEqual(modeChanges, [true]);
    }
    // The parent stops sending before releasing this barrier. Assertions never
    // mistake echo after intentional final restoration for transition exposure.
    await heldWork();
  } else {
    assert.equal(await prompts.ask('Password', true), fixture);
    assert.equal(await prompts.ask('Confirmation', true), fixture);
    assert.deepEqual(modeChanges, [true]);
    await heldWork();
    assert.equal(await prompts.ask('Visible answer'), 'accepted');
  }
  assert.deepEqual(modeChanges, [true]);
  process.stdout.write('SUCCESS\n');
} catch (error) {
  if (!(error instanceof ProvisioningCancelled)) throw error;
  assert.equal(cancellation.signal.aborted, true);
  process.stdout.write('CANCELLED\n');
} finally {
  process.stdout.write('FINAL_RESTORE\n');
  prompts.close();
  prompts.close();
  assert.equal(modeChanges.length, 2);
  process.removeListener('SIGTERM', terminate);
  process.removeListener('SIGUSR2', inputError);
  process.removeListener('SIGHUP', outputError);
}
