export interface StorageUpload {
  key: string;
  path: string;
  size: number;
  contentType: string;
}

export abstract class StorageService {
  abstract readonly namespace: string;
  abstract upload(file: StorageUpload): Promise<void>;
  abstract delete(key: string): Promise<void>;
  abstract getSignedDownloadUrl(key: string): Promise<{ downloadUrl: string; expiresAt: string }>;
}
