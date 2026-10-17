import { RecordsController } from './records.controller';
import { RecordsReadService } from './records-read.service';
import { RecordsWriteService } from './records-write.service';
import { MonthlySnapshotService } from './monthly-snapshot.service';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AttendanceController, RecordsController],
  providers: [
    RecordsReadService,
    RecordsWriteService,
    MonthlySnapshotService,
    AttendanceService,
    JwtAuthGuard,
    RolesGuard,
  ],
})
export class AttendanceModule {}
