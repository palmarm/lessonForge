import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '../generated/prisma/enums.js';
import { AuthConfig } from './auth.config.js';
import { AuthRepository } from './auth.repository.js';
import { sessionToken, tokenHash } from './auth.cookies.js';
import type { AuthRequest } from './auth.types.js';

export const PUBLIC = 'lessonforge:public';
export const ROLES = 'lessonforge:roles';
export const AUTH_ROUTE = 'lessonforge:auth-route';
export const LOGIN_ROUTE = 'lessonforge:login-route';
export const Public = () => SetMetadata(PUBLIC, true);
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthRepository) private readonly repository: AuthRepository,
    @Inject(AuthConfig) private readonly config: AuthConfig,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token = sessionToken(req, this.config);
    const principal = token
      ? await this.repository.authenticate(tokenHash(token))
      : null;
    if (!principal) throw new UnauthorizedException('Authentication required.');
    req.principal = principal;
    return true;
  }
}
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (!req.principal)
      throw new UnauthorizedException('Authentication required.');
    if (!roles.includes(req.principal.user.role))
      throw new ForbiddenException('Forbidden.');
    return true;
  }
}
