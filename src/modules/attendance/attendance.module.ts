import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AttendanceController],
  providers: [AttendanceService, JwtAuthGuard, RolesGuard],
})
export class AttendanceModule {}
