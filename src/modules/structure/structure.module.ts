import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StructureController } from './structure.controller';
import { StructureService } from './structure.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [StructureController],
  providers: [StructureService, JwtAuthGuard, RolesGuard],
})
export class StructureModule {}
