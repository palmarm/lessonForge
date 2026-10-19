import { Module } from '@nestjs/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ResourcesController } from './resources.controller.js';
import { ResourcesService } from './resources.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [ResourcesController],
  providers: [
    {
      provide: ResourcesService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new ResourcesService(prisma.client as PrismaClient),
    },
  ],
})
export class ResourcesModule {}
