import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { emailInput, resetInput } from './auth-advanced.validation';
import { AuthGoogleService } from './auth-google.service';
import { AuthLinksService } from './auth-links.service';
import { AuthRegistrationService } from './auth-registration.service';
import { failure } from './auth.service';

@Controller('auth')
export class AuthAdvancedController {
  constructor(
    private readonly registration: AuthRegistrationService,
    private readonly links: AuthLinksService,
    private readonly google: AuthGoogleService,
    private readonly config: ConfigService,
  ) {}
  @Post('register')
  @HttpCode(202)
  register(@Body() input: unknown, @Req() req: Request) {
    return this.registration.register(input, req.ip ?? 'unknown');
  }
  @Post('google')
  @HttpCode(202)
  googleLogin(@Body() input: unknown, @Req() req: Request) {
    return this.google.login(input, req.ip ?? 'unknown');
  }
  @Post('email-verification/resend')
  @HttpCode(202)
  resend(@Body() input: unknown, @Req() req: Request) {
    return this.links.request(emailInput(input), 'EMAIL_VERIFICATION', req.ip ?? 'unknown');
  }
  @Post('password-recovery')
  @HttpCode(202)
  recovery(@Body() input: unknown, @Req() req: Request) {
    return this.links.request(emailInput(input), 'PASSWORD_RESET', req.ip ?? 'unknown');
  }
  @Post('password-reset')
  @HttpCode(200)
  reset(@Body() input: unknown) {
    const dto = resetInput(input);
    return this.links.reset(dto.token, dto.newPassword);
  }
  @Get('email/verify')
  async verify(@Query() query: Record<string, unknown>, @Res() res: Response) {
    if (
      Object.keys(query).length !== 1 ||
      typeof query.token !== 'string' ||
      !query.token ||
      query.token.length > 4096
    )
      throw failure(401, 'INVALID_TOKEN', 'El enlace no es válido');
    await this.links.verifyEmail(query.token);
    res.redirect(
      302,
      `${this.config.getOrThrow<string>('MOBILE_DEEP_LINK_SCHEME')}://email-verified?success=true`,
    );
  }
}
