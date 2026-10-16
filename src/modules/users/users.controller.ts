import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedRequest, JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UsersService } from './users.service';
import { accountStatus, object, userInput, userQuery, uuid } from './users.validation';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class UsersController {
  constructor(private readonly service: UsersService) {}
  @Get('users') list(@Query() query: Record<string, unknown>) {
    return this.service.list(userQuery(query));
  }
  @Post('users') create(@Body() body: unknown) {
    return this.service.create(userInput(body, true));
  }
  @Get('users/:id') detail(@Param('id') id: string) {
    return this.service.detail(uuid(id));
  }
  @Patch('users/:id') update(@Param('id') id: string, @Body() body: unknown) {
    return this.service.update(uuid(id), userInput(body, false));
  }
  @Patch('users/:id/account-status') status(@Param('id') id: string, @Body() body: unknown) {
    return this.service.status(uuid(id), accountStatus(object(body).accountStatus));
  }
  @Get('profile')
  @Roles(UserRole.EMPLOYEE)
  profile(@Req() request: AuthenticatedRequest) {
    return this.service.profile(request.user!.id);
  }
}
