import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedRequest, JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StructureService } from './structure.service';
import {
  clientInput,
  listQuery,
  object,
  status,
  uuid,
  workplaceInput,
} from './structure.validation';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class StructureController {
  constructor(private readonly service: StructureService) {}
  @Get('sites') sites() {
    return this.service.sites();
  }
  @Get('clients') clients(@Query() query: Record<string, unknown>) {
    return this.service.list(listQuery(query, false), false);
  }
  @Get('clients/:id') client(@Param('id') id: string) {
    return this.service.client(uuid(id, 'INVALID_CLIENT_DATA'));
  }
  @Post('clients') createClient(@Body() body: unknown) {
    return this.service.saveClient(clientInput(body));
  }
  @Put('clients/:id') updateClient(@Param('id') id: string, @Body() body: unknown) {
    return this.service.saveClient(clientInput(body), uuid(id, 'INVALID_CLIENT_DATA'));
  }
  @Patch('clients/:id/status') clientStatus(@Param('id') id: string, @Body() body: unknown) {
    return this.service.clientStatus(
      uuid(id, 'INVALID_CLIENT_DATA'),
      status(object(body, 'INVALID_CLIENT_DATA').status, 'INVALID_CLIENT_DATA'),
    );
  }
  @Get('workplaces')
  @Roles(UserRole.EMPLOYEE, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  workplaces(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    if (request.user!.role === UserRole.EMPLOYEE) return this.service.mobileWorkplaces();
    return this.service.list(listQuery(query, true), true);
  }
  @Get('workplaces/:id') workplace(@Param('id') id: string) {
    return this.service.workplace(uuid(id, 'INVALID_WORKPLACE_DATA'));
  }
  @Post('workplaces') createWorkplace(@Body() body: unknown) {
    return this.service.saveWorkplace(workplaceInput(body));
  }
  @Put('workplaces/:id') updateWorkplace(@Param('id') id: string, @Body() body: unknown) {
    return this.service.saveWorkplace(workplaceInput(body), uuid(id, 'INVALID_WORKPLACE_DATA'));
  }
  @Patch('workplaces/:id/status') workplaceStatus(@Param('id') id: string, @Body() body: unknown) {
    return this.service.workplaceStatus(
      uuid(id, 'INVALID_WORKPLACE_DATA'),
      status(object(body, 'INVALID_WORKPLACE_DATA').status, 'INVALID_WORKPLACE_DATA'),
    );
  }
}
