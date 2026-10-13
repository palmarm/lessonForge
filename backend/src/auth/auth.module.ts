import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, Reflector } from '@nestjs/core';
import type { PrismaClient } from '../generated/prisma/client.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthConfig, resolveAuthConfig } from './auth.config.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { PasswordService } from './password.service.js';
import { AuthenticationGuard, RoleGuard } from './auth.guards.js';
import { AuthRateGuard, BoundedThrottleStorage } from './auth.rate-limit.js';
import { SafeExceptionFilter } from './auth.filter.js';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [
    { provide: AuthConfig, useFactory: () => resolveAuthConfig(process.env) },
    {
      provide: AuthRepository,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new AuthRepository(prisma.client as PrismaClient),
    },
    { provide: PasswordService, useFactory: () => new PasswordService() },
    {
      provide: BoundedThrottleStorage,
      useFactory: () => new BoundedThrottleStorage(),
    },
    AuthService,
    {
      provide: APP_GUARD,
      inject: [BoundedThrottleStorage, Reflector],
      useFactory: (storage: BoundedThrottleStorage, reflector: Reflector) =>
        new AuthRateGuard(storage, reflector),
    },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RoleGuard },
    { provide: APP_FILTER, useClass: SafeExceptionFilter },
  ],
  exports: [AuthConfig, AuthRepository, PasswordService],
})
export class AuthModule {}
