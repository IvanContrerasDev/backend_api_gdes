import { AdminAccessController } from './admin-access.controller';
import { AdminAccessService } from './admin-access.service';
import { AdminAccessNotificationsService } from './admin-access-notifications.service';
import { AdminDecisionTokensService } from './admin-decision-tokens.service';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthAdvancedController } from './auth-advanced.controller';
import { AuthGoogleService } from './auth-google.service';
import { AuthLinksService } from './auth-links.service';
import { AuthRegistrationService } from './auth-registration.service';
import {
  GoogleIdentityService,
  GoogleTokenVerifier,
  googleTokenVerifier,
} from './google-identity.service';
import { PasswordPolicyService } from '../users/password-policy.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
@Module({
  imports: [JwtModule.register({}), NotificationsModule],
  controllers: [AuthController, AuthAdvancedController, AdminAccessController],
  providers: [
    AuthService,
    AdminAccessService,
    AdminAccessNotificationsService,
    AdminDecisionTokensService,
    JwtAuthGuard,
    AuthRegistrationService,
    AuthLinksService,
    AuthGoogleService,
    PasswordPolicyService,
    GoogleIdentityService,
    { provide: GoogleTokenVerifier, useFactory: googleTokenVerifier },
  ],
})
export class AuthModule {}
