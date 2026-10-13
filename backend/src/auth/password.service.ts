import { Logger, ServiceUnavailableException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

export const PASSWORD_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
} as const;
// Exact supported PHC parameters bound native allocation, including salt/output size.
export function supportedHash(hash: string): boolean {
  return /^\$argon2id\$v=19\$m=65536,(?:t=3,p=1|p=1,t=3)\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/.test(
    hash,
  );
}

export class PasswordService {
  private active = 0;
  private closing = false;
  private readonly drained: (() => void)[] = [];
  private readonly queue: (() => void)[] = [];
  private dummy?: Promise<string>;
  private readonly logger = new Logger(PasswordService.name);
  private async bounded<T>(work: () => Promise<T>): Promise<T> {
    if (this.closing)
      throw new ServiceUnavailableException('Service unavailable.');
    if (this.active >= 2) {
      if (this.queue.length >= 8)
        throw new ServiceUnavailableException('Service unavailable.');
      await new Promise<void>((resolve) =>
        this.queue.push(() => {
          this.active++;
          resolve();
        }),
      );
    } else this.active++;
    try {
      return await work();
    } finally {
      this.active--;
      this.queue.shift()?.();
      if (!this.active) this.drained.splice(0).forEach((resolve) => resolve());
    }
  }
  async onModuleInit(): Promise<void> {
    this.dummy ??= this.hash(randomBytes(32).toString('base64url'));
    await this.dummy;
  }
  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    if (this.active)
      await new Promise<void>((resolve) => this.drained.push(resolve));
  }
  hash(password: string): Promise<string> {
    return this.bounded(() =>
      argon2.hash(password, { ...PASSWORD_OPTIONS, salt: randomBytes(16) }),
    );
  }
  async verify(hash: string | undefined, password: string): Promise<boolean> {
    // Initialize a random, non-account dummy once; its native work is bounded too.
    this.dummy ??= this.hash(randomBytes(32).toString('base64url'));
    const dummy = await this.dummy;
    const supported = hash !== undefined && supportedHash(hash);
    if (hash !== undefined && !supported)
      this.logger.warn(
        'Unsupported stored password hash; authentication refused.',
      );
    const valid = await this.bounded(async () => {
      try {
        return await argon2.verify(supported ? hash! : dummy, password);
      } catch {
        this.logger.warn(
          'Stored password verification failed; authentication refused.',
        );
        return false;
      }
    });
    return supported && valid;
  }
}
