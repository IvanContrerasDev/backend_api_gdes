import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  EmailProvider,
  LogNotifications,
  WhatsAppProvider,
} from '../notifications/notifications.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    LogNotifications,
    { provide: EmailProvider, useExisting: LogNotifications },
    { provide: WhatsAppProvider, useExisting: LogNotifications },
  ],
})
export class AuthModule {}
