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
import { validateStorageEndpoints } from '../../config/storage.config';
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
  private readonly signingClient: S3Client;
  constructor(config: ConfigService) {
    super();
    this.bucket = config.getOrThrow<string>('STORAGE_BUCKET');
    const { endpoint, publicEndpoint } = validateStorageEndpoints({
      endpoint: config.getOrThrow<string>('STORAGE_ENDPOINT'),
      publicEndpoint: config.get('STORAGE_PUBLIC_ENDPOINT'),
      allowInsecureHttp: config.get('STORAGE_ALLOW_INSECURE_HTTP'),
      nodeEnv: config.get<string>('NODE_ENV'),
    });
    this.namespace = createHash('sha256')
      .update(JSON.stringify([endpoint.toString(), this.bucket]))
      .digest('hex');
    const clientOptions = {
      region: config.getOrThrow<string>('STORAGE_REGION'),
      credentials: {
        accessKeyId: config.getOrThrow<string>('STORAGE_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('STORAGE_SECRET_ACCESS_KEY'),
      },
      forcePathStyle: true,
      maxAttempts: 1,
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
    };
    this.client = new S3Client({ ...clientOptions, endpoint: endpoint.toString() });
    this.signingClient = new S3Client({ ...clientOptions, endpoint: publicEndpoint.toString() });
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
        this.signingClient,
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
    this.signingClient.destroy();
  }
}
