import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthRepository, tokenCollision } from './auth.repository.js';
import { PasswordService } from './password.service.js';
import { newToken, tokenHash } from './auth.cookies.js';

export class LoginFailure extends UnauthorizedException {
  constructor() {
    super('Invalid email or password.');
  }
}
@Injectable()
export class AuthService {
  private closing = false;
  onModuleDestroy(): void {
    this.closing = true;
  }
  private assertOpen(): void {
    if (this.closing)
      throw new ServiceUnavailableException('Service unavailable.');
  }
  constructor(
    @Inject(AuthRepository) readonly repository: AuthRepository,
    @Inject(PasswordService) readonly passwords: PasswordService,
  ) {}
  async login(email: string, password: string, previousToken?: string) {
    this.assertOpen();
    const user = await this.repository.findLoginUser(email);
    this.assertOpen();
    if (!(await this.passwords.verify(user?.passwordHash, password)) || !user)
      throw new LoginFailure();
    this.assertOpen();
    for (let attempt = 0; attempt < 3; attempt++) {
      this.assertOpen();
      const token = newToken();
      try {
        const principal = await this.repository.rotate(
          user,
          tokenHash(token),
          previousToken ? tokenHash(previousToken) : undefined,
        );
        if (!principal) throw new LoginFailure();
        return { principal, token };
      } catch (error) {
        if (!tokenCollision(error)) throw error;
      }
    }
    throw new ServiceUnavailableException('Service unavailable.');
  }
}
