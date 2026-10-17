import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { ApiException } from '../../common/errors/api.exception';
import { StorageService, StorageUpload } from './storage.service';

export function storageUnavailable(): ApiException {
  return new ApiException(
    503,
    'STORAGE_UNAVAILABLE',
    'El almacenamiento no está disponible; intentá nuevamente',
  );
}

@Injectable()
export class R2StorageService extends StorageService implements OnModuleDestroy {
  readonly namespace: string;
  private readonly client: S3Client;
  private readonly bucket: string;
  constructor(config: ConfigService) {
    super();
    this.bucket = config.getOrThrow<string>('STORAGE_BUCKET');
    const endpoint = new URL(config.getOrThrow<string>('STORAGE_ENDPOINT'));
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if (
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      (endpoint.protocol !== 'https:' &&
        !(
          endpoint.protocol === 'http:' &&
          loopback &&
          config.get<string>('NODE_ENV') !== 'production'
        ))
    )
      throw new Error(
        'STORAGE_ENDPOINT requires HTTPS without credentials, query or fragment (HTTP loopback only in development/test)',
      );
    this.namespace = createHash('sha256')
      .update(JSON.stringify([endpoint.toString(), this.bucket]))
      .digest('hex');
    this.client = new S3Client({
      endpoint: config.getOrThrow<string>('STORAGE_ENDPOINT'),
      region: config.getOrThrow<string>('STORAGE_REGION'),
      credentials: {
        accessKeyId: config.getOrThrow<string>('STORAGE_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('STORAGE_SECRET_ACCESS_KEY'),
      },
      forcePathStyle: true,
      maxAttempts: 1,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }
  async upload(file: StorageUpload): Promise<void> {
    const body = createReadStream(file.path);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: file.key,
          Body: body,
          ContentType: file.contentType,
          ContentLength: file.size,
        }),
        { abortSignal: AbortSignal.timeout(30000) },
      );
    } catch {
      throw storageUnavailable();
    } finally {
      body.destroy();
    }
  }
  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(10000),
      });
    } catch {
      throw storageUnavailable();
    }
  }
  async getSignedDownloadUrl(key: string) {
    try {
      const now = new Date();
      const downloadUrl = await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { expiresIn: 900, signingDate: now },
      );
      return { downloadUrl, expiresAt: new Date(now.getTime() + 900000).toISOString() };
    } catch {
      throw storageUnavailable();
    }
  }
  onModuleDestroy() {
    this.client.destroy();
  }
}
