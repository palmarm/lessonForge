import { PassThrough, Writable } from 'node:stream';
import { createInterface, type Interface } from 'node:readline/promises';
import type { ReadStream, WriteStream } from 'node:tty';
import { assertNotCancelled, ProvisioningCancelled } from './accounts.input.js';

export interface AccountPrompts {
  ask(label: string, secret?: boolean): Promise<string>;
  close(): void;
}

// Each prompt gets a fresh editor: readline's cut/yank and undo buffers are
// independent of history. Between prompts a silent editor keeps cancellation live.
export class TerminalAccountPrompts implements AccountPrompts {
  // Editors receive a plain stream with no terminal-mode methods. Closing one
  // cannot re-enable OS echo; only this owner changes the real terminal mode.
  private readonly editorInput = new PassThrough();
  private active?: { readline: Interface; mute: () => void };
  private readonly closed = new AbortController();
  private readonly wasRaw: boolean;
  private readonly wasPaused: boolean;
  private disposed = false;
  private readonly stop = () => {
    if (this.disposed) return;
    this.cancel();
    this.close();
  };

  constructor(
    private readonly input: ReadStream,
    private readonly output: WriteStream,
    private readonly signal: AbortSignal,
    private readonly cancel: () => void,
  ) {
    this.wasRaw = input.isRaw;
    this.wasPaused = input.isPaused();
    input.on('error', this.stop);
    output.on('error', this.stop);
    signal.addEventListener('abort', this.stop, { once: true });
    try {
      input.setRawMode(true);
      this.replaceInterface(false);
      input.pipe(this.editorInput);
      if (signal.aborted) this.stop();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  private retireInterface(): void {
    const active = this.active;
    this.active = undefined;
    if (!active) return;
    active.mute();
    // Closing an editor for replacement is not a user cancellation.
    active.readline.removeListener('close', this.stop);
    active.readline.close();
  }

  private replaceInterface(visible: boolean): Interface {
    this.retireInterface();
    let forwarding = visible;
    const outputGate = new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        if (forwarding && !this.disposed) this.output.write(chunk);
        callback();
      },
    });
    const readline = createInterface({
      input: this.editorInput,
      output: outputGate,
      terminal: true,
      prompt: '',
      historySize: 0,
    });
    this.active = { readline, mute: () => (forwarding = false) };
    readline.on('SIGINT', this.stop);
    readline.on('SIGTSTP', this.stop);
    readline.on('close', this.stop);
    readline.on('error', this.stop);
    return readline;
  }

  async ask(label: string, secret = false): Promise<string> {
    const signal = AbortSignal.any([this.signal, this.closed.signal]);
    assertNotCancelled(signal);
    const readline = this.replaceInterface(!secret);
    this.output.write(`${label}${secret ? ' [input hidden]' : ''}: `);
    let rejectAnswer: ((reason: Error) => void) | undefined;
    const cancelAnswer = () => rejectAnswer?.(new ProvisioningCancelled());
    try {
      const answer = await new Promise<string>((resolve, reject) => {
        rejectAnswer = reject;
        signal.addEventListener('abort', cancelAnswer, { once: true });
        readline.once('line', (line: string) => {
          // Mute synchronously: another key may follow Enter in the same chunk.
          this.active?.mute();
          resolve(line);
        });
        if (signal.aborted) cancelAnswer();
      });
      assertNotCancelled(signal);
      return answer;
    } catch {
      throw new ProvisioningCancelled();
    } finally {
      signal.removeEventListener('abort', cancelAnswer);
      this.retireInterface();
      if (secret) this.output.write('\n');
      if (!this.disposed) this.replaceInterface(false);
    }
  }

  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active?.mute();
    this.closed.abort();
    try {
      this.retireInterface();
    } finally {
      this.input.unpipe(this.editorInput);
      this.editorInput.destroy();
      try {
        this.input.setRawMode(this.wasRaw);
        if (this.wasPaused) this.input.pause();
      } finally {
        this.input.removeListener('error', this.stop);
        this.output.removeListener('error', this.stop);
        this.signal.removeEventListener('abort', this.stop);
      }
    }
    // Retired output gates stay writable for late redraws, but stay muted.
  }
}
