import {
  Controller,
  HttpCode,
  Get,
  Inject,
  Post,
  Put,
  Req,
  Param,
  SetMetadata,
} from '@nestjs/common';
import { Roles, RESOURCE_ROUTE } from '../auth/auth.guards.js';
import type { AuthRequest } from '../auth/auth.types.js';
import {
  resourceId,
  resourceInput,
  resourceQuery,
  retirementInput,
} from './resources.input.js';
import { ResourcesService } from './resources.service.js';

@Controller('resources')
@Roles('ADMIN', 'TEACHER')
@SetMetadata(RESOURCE_ROUTE, true)
export class ResourcesController {
  constructor(
    @Inject(ResourcesService) private readonly resources: ResourcesService,
  ) {}
  @Get()
  list(@Req() req: AuthRequest) {
    const query = resourceQuery(req.query);
    return this.resources.list(
      req.principal!.user.role,
      query.limit,
      query.after,
    );
  }
  @Get(':id')
  detail(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.resources.detail(req.principal!.user.role, resourceId(id));
  }
  @Post()
  @Roles('ADMIN')
  create(@Req() req: AuthRequest) {
    return this.resources.create(
      req.principal!.user.role,
      resourceInput(req.body),
    );
  }
  @Put(':id')
  @Roles('ADMIN')
  edit(@Req() req: AuthRequest, @Param('id') id: string) {
    const input = resourceInput(req.body, true);
    return this.resources.mutate(
      req.principal!.user.role,
      resourceId(id),
      input.expectedVersion!,
      input,
    );
  }
  @Post(':id/retire')
  @HttpCode(200)
  @Roles('ADMIN')
  retire(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.resources.mutate(
      req.principal!.user.role,
      resourceId(id),
      retirementInput(req.body),
    );
  }
}
