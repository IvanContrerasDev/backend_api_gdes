import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import multer from 'multer';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { lastValueFrom, of } from 'rxjs';
import { ApiException } from '../../common/errors/api.exception';
import { invalidFileData } from './files.errors';
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

@Injectable()
export class MultipartInterceptor implements NestInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    if (!req.is('multipart/form-data')) invalidFileData('Se requiere una carga multipart');
    const folder = await mkdtemp(join(tmpdir(), 'gdes-upload-'));
    const cleanup = () => void rm(folder, { recursive: true, force: true }).catch(() => undefined);
    req.once('aborted', cleanup);
    try {
      const replacing = req.method === 'PUT';
      const options = {
        storage: multer.diskStorage({
          destination: folder,
          filename: (_req, _file, cb) => cb(null, randomUUID()),
        }),
        preservePath: true,
        defParamCharset: 'utf8',
        limits: {
          fileSize: MAX_FILE_BYTES,
          files: replacing ? 1 : 10,
          fields: 8,
          parts: replacing ? 2 : 18,
          fieldNameSize: 50,
          fieldSize: 4096,
          fieldArrayIndexLimit: 0,
        },
      };
      const parse = multer(options).array(replacing ? 'file' : 'files', replacing ? 1 : 10);
      await new Promise<void>((resolve, reject) =>
        parse(req, res, (error: unknown) => (error ? reject(error) : resolve())),
      );
      if (req.aborted) invalidFileData('La carga fue cancelada');
      if (!Array.isArray(req.files) || !req.files.length)
        invalidFileData('Debe incluir al menos un archivo');
      return of(await lastValueFrom(next.handle()));
    } catch (error) {
      if (error instanceof ApiException) throw error;
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE')
        throw new ApiException(422, 'FILE_TOO_LARGE', 'El archivo supera el máximo de 20 MiB');
      // Parser messages can contain raw client data and are never exposed.
      if (
        error instanceof multer.MulterError ||
        (error instanceof Error &&
          /multipart|boundary|unexpected end|malformed|aborted/i.test(error.message))
      )
        invalidFileData('La carga multipart no es válida');
      throw error;
    } finally {
      req.removeListener('aborted', cleanup);
      await rm(folder, { recursive: true, force: true });
    }
  }
}
