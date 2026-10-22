import {
  Controller,
  Get,
  Post,
  Put,
  Req,
  Param,
  Inject,
  HttpCode,
  SetMetadata,
} from '@nestjs/common';
import { Roles, LESSON_ROUTE } from '../auth/auth.guards.js';
import type { AuthRequest } from '../auth/auth.types.js';
import {
  resourceId,
  resourceQuery,
  retirementInput,
} from '../resources/resources.input.js';
import { lessonInput } from './lessons.input.js';
import { LessonsService } from './lessons.service.js';

@Controller('lessons')
@Roles('TEACHER')
@SetMetadata(LESSON_ROUTE, true)
export class LessonsController {
  constructor(
    @Inject(LessonsService) private readonly lessons: LessonsService,
  ) {}
  @Get()
  list(@Req() req: AuthRequest) {
    const { limit, after } = resourceQuery(req.query);
    return this.lessons.list(req.principal!.user, limit, after);
  }
  @Get(':id')
  detail(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.lessons.detail(req.principal!.user, resourceId(id));
  }
  @Post()
  create(@Req() req: AuthRequest) {
    return this.lessons.create(
      req.principal!.user,
      lessonInput(req.body).content,
    );
  }
  @Put(':id')
  save(@Req() req: AuthRequest, @Param('id') id: string) {
    const input = lessonInput(req.body, true);
    return this.lessons.mutate(
      req.principal!.user,
      resourceId(id),
      input.expectedVersion!,
      { content: input.content },
    );
  }
  private selection(
    req: AuthRequest,
    id: string,
    key: string,
    action: 'select' | 'remove' | 'refresh',
  ) {
    return this.lessons.mutate(
      req.principal!.user,
      resourceId(id),
      retirementInput(req.body),
      { action, resourceId: resourceId(key) },
    );
  }
  @Post(':id/resources/:resourceId/select')
  @HttpCode(200)
  select(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Param('resourceId') key: string,
  ) {
    return this.selection(req, id, key, 'select');
  }
  @Post(':id/resources/:resourceId/remove')
  @HttpCode(200)
  remove(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Param('resourceId') key: string,
  ) {
    return this.selection(req, id, key, 'remove');
  }
  @Post(':id/resources/:resourceId/refresh')
  @HttpCode(200)
  refresh(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Param('resourceId') key: string,
  ) {
    return this.selection(req, id, key, 'refresh');
  }
}
