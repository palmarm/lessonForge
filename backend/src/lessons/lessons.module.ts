import { Module } from '@nestjs/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LessonsService } from './lessons.service.js';
import { LessonsController } from './lessons.controller.js';
import { LessonWorkflowService } from './lesson-workflow.service.js';
import {
  LessonWorkflowController,
  PendingReviewsController,
} from './lesson-workflow.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [
    LessonsController,
    LessonWorkflowController,
    PendingReviewsController,
  ],
  providers: [
    {
      provide: LessonWorkflowService,
      inject: [PrismaService],
      useFactory: (db: PrismaService) =>
        new LessonWorkflowService(db.client as PrismaClient),
    },
    {
      provide: LessonsService,
      inject: [PrismaService],
      useFactory: (db: PrismaService) =>
        new LessonsService(db.client as PrismaClient),
    },
  ],
})
export class LessonsModule {}
