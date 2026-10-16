import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthenticatedRequest, JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ChallengeDto, LoginDto, RefreshDto, VerifyDto } from './auth.dto';
import { AuthService, failure, invalid } from './auth.service';
const REFRESH = '__Host-gdes-refresh';
const PREAUTH = '__Host-gdes-preauth';
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}
  cookies(req: Request): Record<string, string> {
    const cookies = Object.create(null) as Record<string, string>;
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const index = part.indexOf('=');
      if (index >= 0) {
        const name = part.slice(0, index).trim();
        if (name in cookies) throw invalid();
        cookies[name] = part.slice(index + 1).trim();
      }
    }
    return cookies;
  }
  cookie(res: Response, name: string, value: string, maxAge?: number) {
    res.cookie(name, value, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      ...(maxAge === undefined ? {} : { maxAge }),
    });
  }
  clear(res: Response) {
    this.cookie(res, REFRESH, '', 0);
    this.cookie(res, PREAUTH, '', 0);
  }
  async csrfCheck(req: Request, allowUsed = false) {
    if (
      req.headers.origin !== this.config.getOrThrow<string>('ADMIN_FRONTEND_URL') ||
      typeof req.headers['x-csrf-token'] !== 'string'
    )
      throw failure(400, 'BAD_REQUEST', 'Origen o token CSRF inválido');
    const cookies = this.cookies(req);
    let secret: string;
    if (cookies[REFRESH]) {
      const t = await this.auth.session(cookies[REFRESH], 'ADMIN', allowUsed);
      secret = t.session.csrfSecret;
    } else {
      secret = cookies[PREAUTH];
      if (!secret || !/^[\w-]{43}$/.test(secret))
        throw failure(400, 'BAD_REQUEST', 'Sesión previa ausente');
    }
    if (!this.auth.equal(this.auth.csrf(secret), req.headers['x-csrf-token']))
      throw failure(400, 'BAD_REQUEST', 'Token CSRF inválido');
    return cookies[PREAUTH];
  }
  webResult(result: Awaited<ReturnType<AuthService['verify']>>, res: Response) {
    this.cookie(
      res,
      REFRESH,
      result.refreshToken,
      result.session.rememberSession
        ? Math.max(0, result.session.expiresAt.getTime() - Date.now())
        : undefined,
    );
    this.cookie(res, PREAUTH, '', 0);
    return {
      ...result.response,
      sessionExpiresAt: result.session.expiresAt.toISOString(),
      rememberSession: result.session.rememberSession,
    };
  }
  @Post('login')
  @HttpCode(202)
  async login(
    @Body() input: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    let preauth: string | undefined;
    if (input.client === 'ADMIN') {
      try {
        preauth = await this.csrfCheck(req);
        if (!preauth || this.cookies(req)[REFRESH])
          throw failure(400, 'BAD_REQUEST', 'Cerrá la sesión actual antes de iniciar otra');
      } catch (e) {
        if ((e as { status?: number }).status === 401) this.clear(res);
        throw e;
      }
    } else if (input.rememberSession !== undefined)
      throw failure(400, 'BAD_REQUEST', 'Recordar sesión corresponde solo a ADMIN');
    return this.auth.login(input, req.ip ?? 'unknown', preauth);
  }
  @Post('otp/verify')
  @HttpCode(200)
  async verify(@Body() input: VerifyDto, @Req() req: Request) {
    const r = await this.auth.verify(input.challengeId, input.code, 'MOBILE', req.ip ?? 'unknown');
    return { ...r.response, tokens: { ...r.response.tokens, refreshToken: r.refreshToken } };
  }
  @Post('login/2fa/verify')
  @HttpCode(200)
  async verifyWeb(
    @Body() input: VerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const preauth = await this.csrfCheck(req);
    if (!preauth) throw failure(400, 'BAD_REQUEST', 'Cerrá la sesión actual antes de iniciar otra');
    return this.webResult(
      await this.auth.verify(input.challengeId, input.code, 'ADMIN', req.ip ?? 'unknown', preauth),
      res,
    );
  }
  @Post('otp/resend')
  @HttpCode(202)
  resend(@Body() input: ChallengeDto, @Req() req: Request) {
    return this.auth.resend(input.challengeId, req.ip ?? 'unknown');
  }
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() input: RefreshDto) {
    const r = await this.auth.rotate(input.refreshToken, 'MOBILE');
    return { tokens: { ...r.response.tokens, refreshToken: r.refreshToken } };
  }
  @Post('logout')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req: AuthenticatedRequest) {
    if (!req.user?.sessionId || req.user.client !== 'MOBILE') throw invalid();
    await this.auth.logoutSession(req.user.sessionId);
  }
  @Get('web/csrf')
  async csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookies = this.cookies(req);
    if (cookies[REFRESH]) {
      try {
        const t = await this.auth.session(cookies[REFRESH], 'ADMIN');
        return { csrfToken: this.auth.csrf(t.session.csrfSecret) };
      } catch (e) {
        this.clear(res);
        throw e;
      }
    }
    let secret = cookies[PREAUTH];
    if (!secret || !/^[\w-]{43}$/.test(secret)) {
      secret = this.auth.random();
      this.cookie(res, PREAUTH, secret);
    }
    return { csrfToken: this.auth.csrf(secret) };
  }
  @Get('web/session')
  async session(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const token = this.cookies(req)[REFRESH];
      if (!token) throw invalid();
      const t = await this.auth.session(token, 'ADMIN');
      return {
        user: this.auth.publicUser(t.session.user),
        sessionExpiresAt: t.session.expiresAt.toISOString(),
        rememberSession: t.session.rememberSession,
      };
    } catch (e) {
      this.clear(res);
      throw e;
    }
  }
  @Post('web/refresh')
  @HttpCode(200)
  async refreshWeb(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      await this.csrfCheck(req, true);
      const token = this.cookies(req)[REFRESH];
      if (!token) throw invalid();
      return this.webResult(await this.auth.rotate(token, 'ADMIN'), res);
    } catch (e) {
      if ((e as { status?: number }).status === 401 || (e as { status?: number }).status === 403)
        this.clear(res);
      throw e;
    }
  }
  @Post('web/logout')
  @HttpCode(204)
  async logoutWeb(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      await this.csrfCheck(req, true);
      const token = this.cookies(req)[REFRESH];
      if (!token) throw invalid();
      const t = await this.auth.session(token, 'ADMIN', true);
      await this.auth.logoutSession(t.sessionId);
      this.clear(res);
    } catch (e) {
      if ((e as { status?: number }).status === 401) this.clear(res);
      throw e;
    }
  }
}
