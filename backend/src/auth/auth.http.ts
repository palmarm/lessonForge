import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json, type Request, type Response, type NextFunction } from 'express';
import type { AuthConfig } from './auth.config.js';

// Also used by HTTP regression tests. Built-in body parsing is disabled in bootstrap.
export function configureAuthHttp(
  app: NestExpressApplication,
  config: AuthConfig,
): void {
  app.getHttpAdapter().getInstance().set('trust proxy', false);
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    res.vary('Origin');
    next();
  });
  app.enableCors({
    origin: (origin, callback) =>
      callback(
        null,
        origin !== undefined && config.allowedOrigins.includes(origin),
      ),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-LessonForge-CSRF'],
    maxAge: 600,
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (
      !req.headers.origin ||
      !config.allowedOrigins.includes(req.headers.origin) ||
      req.headers['x-lessonforge-csrf'] !== '1' ||
      req.headers['sec-fetch-site'] === 'cross-site'
    )
      return res.status(403).json({ statusCode: 403, message: 'Forbidden.' });
    if (!req.is('application/json'))
      return res
        .status(415)
        .json({ statusCode: 415, message: 'JSON required.' });
    next();
  });
  app.use(cookieParser());
  const parse = json({ limit: '4kb', strict: true });
  app.use((req: Request, res: Response, next: NextFunction) => {
    parse(req, res, (error?: { status?: number }) => {
      if (!error) return next();
      const status = error.status === 413 ? 413 : 400;
      res.status(status).json({
        statusCode: status,
        message:
          status === 413 ? 'Request body too large.' : 'Invalid request.',
      });
    });
  });
}
