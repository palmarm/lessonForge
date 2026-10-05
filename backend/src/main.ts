import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { resolvePort } from './port.js';

async function bootstrap() {
  const port = resolvePort(process.env.PORT);
  const app = await NestFactory.create(AppModule);
  await app.listen(port);
}
await bootstrap();
