import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  SetMetadata,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service.js';
import { AuthConfig } from './auth.config.js';
import { AUTH_ROUTE, LOGIN_ROUTE, Public } from './auth.guards.js';
import {
  clearSessionCookie,
  sessionToken,
  setSessionCookie,
  tokenHash,
} from './auth.cookies.js';
import { emptyInput, loginInput } from './auth.input.js';
import type { AuthRequest } from './auth.types.js';

@Controller('auth')
@SetMetadata(AUTH_ROUTE, true)
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuthConfig) private readonly config: AuthConfig,
  ) {}
  @Post('login')
  @Public()
  @SetMetadata(LOGIN_ROUTE, true)
  @HttpCode(200)
  async login(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = loginInput(req.body);
    const { principal, token } = await this.auth.login(
      input.email,
      input.password,
      sessionToken(req, this.config),
    );
    setSessionCookie(res, this.config, token);
    return principal;
  }
  @Get('me')
  me(@Req() req: AuthRequest) {
    return req.principal;
  }
  @Post('logout')
  @Public()
  @HttpCode(204)
  async logout(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    emptyInput(req.body);
    const token = sessionToken(req, this.config);
    if (token) await this.auth.repository.revoke(tokenHash(token));
    clearSessionCookie(res, this.config);
  }
}
