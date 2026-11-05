import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  Param,
  Inject,
  SetMetadata,
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles, LESSON_ROUTE } from '../auth/auth.guards.js';
import type { AuthRequest } from '../auth/auth.types.js';
import { resourceId, resourceQuery } from '../resources/resources.input.js';
import { copyInput, copyOperationKey } from './library.input.js';
import { LibraryService } from './library.service.js';

@Controller('library')
@Roles('TEACHER', 'ADMIN')
@SetMetadata(LESSON_ROUTE, true)
export class LibraryController {
  constructor(
    @Inject(LibraryService) private readonly library: LibraryService,
  ) {}

  @Get('approved')
  list(@Req() req: AuthRequest) {
    const { limit, after } = resourceQuery(req.query);
    return this.library.list(req.principal!.user, limit, after);
  }
  @Get('approved/:lessonId/revisions/:revisionId')
  detail(
    @Req() req: AuthRequest,
    @Param('lessonId') lessonId: string,
    @Param('revisionId') revisionId: string,
  ) {
    return this.library.detail(
      req.principal!.user,
      resourceId(lessonId),
      resourceId(revisionId),
    );
  }
  @Get('copy-operations/:operationKey')
  @Roles('TEACHER')
  recover(@Req() req: AuthRequest, @Param('operationKey') key: string) {
    return this.library.recover(req.principal!.user, copyOperationKey(key));
  }
}

@Controller('lessons')
@Roles('TEACHER')
@SetMetadata(LESSON_ROUTE, true)
export class LessonCopyController {
  constructor(
    @Inject(LibraryService) private readonly library: LibraryService,
  ) {}

  @Post(':lessonId/revisions/:revisionId/copy')
  async copy(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('lessonId') lessonId: string,
    @Param('revisionId') revisionId: string,
  ) {
    const response = await this.library.copy(
      req.principal!.user,
      resourceId(lessonId),
      resourceId(revisionId),
      copyInput(req.body),
    );
    res.status(response.created ? 201 : 200);
    return response.result;
  }
}
