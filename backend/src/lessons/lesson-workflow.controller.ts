import {
  Controller,
  Get,
  Post,
  Req,
  Param,
  Inject,
  SetMetadata,
} from '@nestjs/common';
import { Roles, LESSON_ROUTE } from '../auth/auth.guards.js';
import type { AuthRequest } from '../auth/auth.types.js';
import {
  resourceId,
  resourceQuery,
  retirementInput,
} from '../resources/resources.input.js';
import { reviewInput } from './lesson-workflow.input.js';
import { LessonWorkflowService } from './lesson-workflow.service.js';

@Controller('lessons')
@Roles('TEACHER', 'ADMIN')
@SetMetadata(LESSON_ROUTE, true)
export class LessonWorkflowController {
  constructor(
    @Inject(LessonWorkflowService)
    private readonly workflow: LessonWorkflowService,
  ) {}
  @Post(':id/submit')
  @Roles('TEACHER')
  submit(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.workflow.submit(
      req.principal!.user,
      resourceId(id),
      retirementInput(req.body),
    );
  }
  @Get(':id/revisions')
  history(@Req() req: AuthRequest, @Param('id') id: string) {
    const { limit, after } = resourceQuery(req.query);
    return this.workflow.history(
      req.principal!.user,
      resourceId(id),
      limit,
      after,
    );
  }
  @Get(':id/revisions/:revisionId')
  detail(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Param('revisionId') revisionId: string,
  ) {
    return this.workflow.detail(
      req.principal!.user,
      resourceId(id),
      resourceId(revisionId),
    );
  }
  @Post(':id/revisions/:revisionId/review')
  @Roles('ADMIN')
  review(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Param('revisionId') revisionId: string,
  ) {
    return this.workflow.review(
      req.principal!.user,
      resourceId(id),
      resourceId(revisionId),
      reviewInput(req.body),
    );
  }
}

@Controller('reviews')
@Roles('ADMIN')
@SetMetadata(LESSON_ROUTE, true)
export class PendingReviewsController {
  constructor(
    @Inject(LessonWorkflowService)
    private readonly workflow: LessonWorkflowService,
  ) {}
  @Get('pending')
  pending(@Req() req: AuthRequest) {
    const { limit, after } = resourceQuery(req.query);
    return this.workflow.pending(req.principal!.user, limit, after);
  }
}
