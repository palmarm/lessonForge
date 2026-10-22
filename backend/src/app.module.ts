import { ResourcesModule } from './resources/resources.module.js';
import { LessonsModule } from './lessons/lessons.module.js';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, AuthModule, ResourcesModule, LessonsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
