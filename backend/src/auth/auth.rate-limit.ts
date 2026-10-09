import { createHash } from 'node:crypto';
import {
  ExecutionContext,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  type ThrottlerStorage,
  type ThrottlerLimitDetail,
} from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { canonicalEmail } from './auth.input.js';
import { AUTH_ROUTE, LOGIN_ROUTE } from './auth.guards.js';

type Entry = { hits: number[]; expires: number };
// No interval/listener keeps Node alive. Entries expire lazily; live keys are never evicted.
export class BoundedThrottleStorage implements ThrottlerStorage {
  private readonly entries = new Map<string, Entry>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly capacity = 10000,
  ) {}
  increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    _name: string,
  ) {
    const now = this.now();
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= this.capacity)
        for (const [id, value] of this.entries)
          if (value.expires <= now) this.entries.delete(id);
      if (this.entries.size >= this.capacity)
        throw new ServiceUnavailableException('Service unavailable.');
      entry = { hits: [], expires: now + ttl };
      this.entries.set(key, entry);
    }
    entry.hits = entry.hits.filter((time) => time > now);
    const isBlocked = entry.hits.length >= limit;
    if (!isBlocked) {
      entry.hits.push(now + ttl);
      entry.expires = now + ttl;
    }
    const remaining = Math.max(
      1,
      Math.ceil(((entry.hits[0] ?? now + ttl) - now) / 1000),
    );
    return Promise.resolve({
      totalHits: entry.hits.length,
      timeToExpire: remaining,
      isBlocked,
      timeToBlockExpire: remaining,
    });
  }
  onApplicationShutdown(): void {
    this.entries.clear();
  }
}
export class AuthRateGuard extends ThrottlerGuard {
  constructor(storage: BoundedThrottleStorage, reflector: Reflector) {
    const isAuth = (context: ExecutionContext) =>
      reflector.get<boolean>(AUTH_ROUTE, context.getClass()) === true;
    const isLogin = (context: ExecutionContext) =>
      reflector.get<boolean>(LOGIN_ROUTE, context.getHandler()) === true;
    super(
      {
        throttlers: [
          {
            name: 'login-ip',
            ttl: 300000,
            limit: 20,
            setHeaders: false,
            skipIf: (context) => !isLogin(context),
          },
          {
            name: 'login-email',
            ttl: 300000,
            limit: 5,
            setHeaders: false,
            skipIf: (context) => !isLogin(context),
          },
          {
            name: 'auth',
            ttl: 60000,
            limit: 120,
            setHeaders: false,
            skipIf: (context) => !isAuth(context) || isLogin(context),
          },
        ],
      },
      storage,
      reflector,
    );
  }
  protected generateKey(
    context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    if (name === 'login-email') {
      const req = context.switchToHttp().getRequest<Request>();
      const email =
        canonicalEmail(
          (req.body as Record<string, unknown> | undefined)?.email,
        ) ?? 'invalid-input';
      suffix += createHash('sha256').update(email).digest('hex');
    }
    // Share the auth IP budget across me/logout; route aliases cannot split quotas.
    return createHash('sha256')
      .update(name + '\0' + suffix)
      .digest('hex');
  }
  protected throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Retry-After', String(Math.max(1, detail.timeToBlockExpire)));
    return Promise.reject(new HttpException('Too many requests.', 429));
  }
}
