import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { StorageModule } from '../storage/storage.module';
import { FilesController } from './files.controller';
import { CatalogsController } from './catalogs.controller';
import { FilesReadService } from './files-read.service';
import { FilesWriteService } from './files-write.service';
import { MultipartInterceptor } from './multipart.interceptor';
@Module({
  imports: [JwtModule.register({}), StorageModule],
  controllers: [FilesController, CatalogsController],
  providers: [FilesReadService, FilesWriteService, JwtAuthGuard, RolesGuard, MultipartInterceptor],
})
export class FilesModule {}
