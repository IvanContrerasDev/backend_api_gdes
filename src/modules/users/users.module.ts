import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PasswordPolicyService } from './password-policy.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
@Module({
  imports: [JwtModule.register({})],
  controllers: [UsersController],
  providers: [UsersService, PasswordPolicyService, JwtAuthGuard, RolesGuard],
})
export class UsersModule {}
