import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedRequest, JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AttendanceService } from './attendance.service';

@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.EMPLOYEE)
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}
  @Post('events')
  async ingest(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.ingest(req.user!, body);
    res.status(result.replay ? 200 : 201);
    return result.data;
  }
  @Get('status')
  status(@Req() req: AuthenticatedRequest) {
    return this.service.status(req.user!);
  }
}
