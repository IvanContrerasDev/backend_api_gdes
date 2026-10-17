import { Module } from '@nestjs/common';
import { R2StorageService } from './r2-storage.service';
import { StorageService } from './storage.service';
import { StorageCleanupService } from './storage-cleanup.service';

@Module({
  providers: [
    R2StorageService,
    { provide: StorageService, useExisting: R2StorageService },
    StorageCleanupService,
  ],
  exports: [StorageService, StorageCleanupService],
})
export class StorageModule {}
