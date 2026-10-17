import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { ApiException } from '../../common/errors/api.exception';
import { invalidFileData, fileTypeError } from './files.errors';
import { MAX_FILE_BYTES } from './multipart.interceptor';
import { isOleWord } from './ole-word';
import { isDocx } from './docx-validation';

export interface ValidFile {
  path: string;
  fileName: string;
  fileExtension: string;
  fileSizeBytes: number;
  contentType: string;
}
export function visibleName(value: unknown): string {
  if (typeof value !== 'string') invalidFileData();
  if (/\p{Cc}/u.test(value)) invalidFileData('El nombre del archivo no es válido');
  const name = value.trim();
  if (
    !name ||
    [...name].length > 120 ||
    /[\\/]/.test(name) ||
    [...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    name === '.' ||
    name === '..'
  )
    invalidFileData('El nombre del archivo no es válido');
  return name;
}
function png(bytes: Buffer) {
  if (bytes.length < 45 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
    return false;
  let offset = 8,
    header = false,
    image = false;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    if (size > bytes.length - offset - 12) return false;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!header) {
      if (
        type !== 'IHDR' ||
        size !== 13 ||
        !bytes.readUInt32BE(offset + 8) ||
        !bytes.readUInt32BE(offset + 12)
      )
        return false;
      header = true;
    }
    if (type === 'IDAT') image = true;
    offset += size + 12;
    if (type === 'IEND') return image && size === 0 && offset === bytes.length;
  }
  return false;
}
function jpeg(bytes: Buffer) {
  if (bytes.length < 8 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let offset = 2,
    frame = false;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (offset + 2 > bytes.length) return false;
    const size = bytes.readUInt16BE(offset);
    if (size < 2 || offset + size > bytes.length) return false;
    if ([0xc0, 0xc1, 0xc2].includes(marker))
      frame = size >= 8 && bytes.readUInt16BE(offset + 3) > 0 && bytes.readUInt16BE(offset + 5) > 0;
    if (marker === 0xda)
      return frame && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
    offset += size;
  }
  return false;
}
export async function validateFiles(files: Express.Multer.File[]): Promise<ValidFile[]> {
  if (!files.length || files.length > 10) invalidFileData();
  const result: ValidFile[] = [];
  for (const file of files) {
    const fileName = visibleName(file.originalname);
    const extension = extname(fileName).slice(1).toLowerCase();
    if (!['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'txt'].includes(extension)) fileTypeError();
    if (file.size > MAX_FILE_BYTES)
      throw new ApiException(422, 'FILE_TOO_LARGE', 'El archivo supera el máximo de 20 MiB');
    if (!file.size) invalidFileData('No se permiten archivos vacíos');
    let contentType: string;
    if (extension === 'docx') {
      if (!(await isDocx(file.path))) fileTypeError();
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else {
      // Sequential per-file inspection bounds memory independently of batch size.
      const bytes = await readFile(file.path);
      if (extension === 'txt') {
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          // eslint-disable-next-line no-control-regex -- Reject binary control bytes in UTF-8 text.
          if (/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(text)) fileTypeError();
        } catch {
          fileTypeError();
        }
        contentType = 'text/plain';
      } else if (extension === 'pdf') {
        if (
          !/^%PDF-[12]\.\d/.test(bytes.subarray(0, 8).toString('ascii')) ||
          !/%%EOF\s*$/.test(bytes.subarray(-1024).toString('ascii'))
        )
          fileTypeError();
        contentType = 'application/pdf';
      } else if (extension === 'png') {
        if (!png(bytes)) fileTypeError();
        contentType = 'image/png';
      } else if (extension === 'doc') {
        if (!isOleWord(bytes)) fileTypeError();
        contentType = 'application/msword';
      } else {
        if (!jpeg(bytes)) fileTypeError();
        contentType = 'image/jpeg';
      }
    }
    result.push({
      path: file.path,
      fileName,
      fileExtension: extension,
      fileSizeBytes: file.size,
      contentType,
    });
  }
  return result;
}
