import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AdminAccessService } from './admin-access.service';
import { adminChallengeInput, adminDecisionInput } from './admin-access.validation';
@Controller('auth')
export class AdminAccessController {
  constructor(private readonly service: AdminAccessService) {}
  @Post('admin-access-request')
  @HttpCode(202)
  start(@Body() value: unknown, @Req() req: Request) {
    return this.service.start(value, req.ip ?? 'unknown');
  }
  @Post('admin-access-request/verify')
  @HttpCode(202)
  verify(@Body() value: unknown, @Req() req: Request) {
    const input = adminChallengeInput(value, true);
    return this.service.verify(input.id, input.code, req.ip ?? 'unknown');
  }
  @Post('admin-access-request/resend')
  @HttpCode(202)
  resend(@Body() value: unknown, @Req() req: Request) {
    return this.service.resend(adminChallengeInput(value, false).id, req.ip ?? 'unknown');
  }
  @Post('admin-access/confirm')
  @HttpCode(200)
  confirm(@Body() value: unknown) {
    const input = adminDecisionInput(value);
    return this.service.confirm(input.token, input.decision);
  }
}
