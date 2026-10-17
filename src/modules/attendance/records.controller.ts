import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedRequest, JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RecordsReadService } from './records-read.service';
import { RecordsWriteService } from './records-write.service';
import { MonthlySnapshotService } from './monthly-snapshot.service';
import { monthlyQuery, recordId } from './records.validation';
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class RecordsController {
  constructor(
    private readonly read: RecordsReadService,
    private readonly write: RecordsWriteService,
    private readonly snapshots: MonthlySnapshotService,
  ) {}
  @Get('records/monthly') monthly(
    @Req() req: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return this.snapshots.monthly(req.user!.id, monthlyQuery(query));
  }
  @Get('records/:id') detail(@Param('id') id: string) {
    return this.read.detail(recordId(id));
  }
  @Get('attendance-events/:id') event(@Param('id') id: string) {
    return this.read.event(recordId(id));
  }
  @Post('records') create(@Body() body: unknown) {
    return this.write.create(body);
  }
  @Patch('records/:id') update(@Param('id') id: string, @Body() body: unknown) {
    return this.write.update(recordId(id), body);
  }
  @Patch('records/:id/review') review(@Param('id') id: string, @Body() body: unknown) {
    return this.write.review(recordId(id), body);
  }
}
