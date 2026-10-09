import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import { LoginFailure } from './auth.service.js';

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 503;
    const messages: Record<number, string> = {
      400: 'Invalid request.',
      401: 'Authentication required.',
      403: 'Forbidden.',
      404: 'Not found.',
      413: 'Request body too large.',
      415: 'JSON required.',
      429: 'Too many requests.',
      503: 'Service unavailable.',
    };
    if (status === 503 && !res.hasHeader('Retry-After'))
      res.setHeader('Retry-After', '1');
    res.status(status).json({
      statusCode: status,
      message:
        error instanceof LoginFailure
          ? 'Invalid email or password.'
          : (messages[status] ?? 'Request failed.'),
    });
  }
}
