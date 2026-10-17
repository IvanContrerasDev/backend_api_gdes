import { Injectable } from '@nestjs/common';
import { DocumentType, Prisma, TimesheetStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ApiException } from '../../common/errors/api.exception';
import { AuthenticatedUser } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { StorageCleanupService } from '../storage/storage-cleanup.service';
import { documentDto, documentInclude, timesheetDto, timesheetInclude } from './file-dto';
import { validateFiles, ValidFile } from './file-validation';
import { notFound } from './files.errors';

interface UploadInput {
  employeeId: string;
  workplaceId: string | null;
  month?: number;
  year?: number;
  type?: DocumentType;
}

@Injectable()
export class FilesWriteService {
  constructor(
    private readonly db: PrismaService,
    private readonly storage: StorageService,
    private readonly cleanup: StorageCleanupService,
  ) {}
  private async context(
    tx: Prisma.TransactionClient,
    employeeId: string,
    workplaceId: string | null,
    auth?: AuthenticatedUser,
  ) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${employeeId}::uuid FOR UPDATE`;
    const employee = await tx.user.findUnique({ where: { id: employeeId } });
    if (!employee || employee.role !== 'EMPLOYEE')
      throw new ApiException(404, 'USER_NOT_FOUND', 'El empleado no existe');
    if (employee.accountStatus !== 'ACTIVE')
      throw new ApiException(403, 'ACCOUNT_INACTIVE', 'La cuenta está desactivada');
    if (auth?.role === 'EMPLOYEE') {
      const session = await tx.authSession.findUnique({ where: { id: auth.sessionId } });
      if (
        !employee.emailVerifiedAt ||
        !session ||
        session.userId !== auth.id ||
        session.client !== 'MOBILE' ||
        session.role !== 'EMPLOYEE' ||
        session.revokedAt ||
        session.expiresAt.getTime() <= Date.now()
      )
        throw new ApiException(401, 'INVALID_TOKEN', 'La sesión no es válida');
    }
    if (workplaceId === null) return;
    await tx.$queryRaw`SELECT id FROM "Workplace" WHERE id=${workplaceId}::uuid FOR UPDATE`;
    const workplace = await tx.workplace.findUnique({ where: { id: workplaceId } });
    if (!workplace || workplace.status !== 'ACTIVE')
      throw new ApiException(404, 'WORKPLACE_NOT_FOUND', 'El lugar de trabajo no está disponible');
    await tx.$queryRaw`SELECT id FROM "Client" WHERE id=${workplace.clientId}::uuid FOR UPDATE`;
    const client = await tx.client.findUnique({ where: { id: workplace.clientId } });
    if (!client || client.status !== 'ACTIVE')
      throw new ApiException(409, 'CLIENT_INACTIVE', 'El cliente está inactivo');
  }
  private fileData(file: ValidFile) {
    return {
      fileName: file.fileName,
      fileExtension: file.fileExtension,
      fileSizeBytes: file.fileSizeBytes,
      contentType: file.contentType,
    };
  }
  private async push(files: ValidFile[], keys: string[]) {
    for (let i = 0; i < files.length; i++)
      await this.storage.upload({
        key: keys[i],
        path: files[i].path,
        size: files[i].fileSizeBytes,
        contentType: files[i].contentType,
      });
  }
  async upload(
    input: UploadInput,
    auth: AuthenticatedUser,
    raw: Express.Multer.File[],
    timesheet: boolean,
  ) {
    const files = await validateFiles(raw);
    await this.db.$transaction((tx) => this.context(tx, input.employeeId, input.workplaceId, auth));
    const ids = files.map(() => randomUUID());
    const keys = files.map((file, index) =>
      timesheet
        ? `timesheets/${input.employeeId}/${input.year}-${String(input.month).padStart(2, '0')}/${ids[index]}/${randomUUID()}/${file.fileName}`
        : `documents/${input.employeeId}/${ids[index]}/${randomUUID()}/${file.fileName}`,
    );
    await this.cleanup.journal(keys);
    try {
      await this.push(files, keys);
      const created = await this.db.$transaction(
        async (tx) => {
          await this.context(tx, input.employeeId, input.workplaceId, auth);
          await this.cleanup.claimPublication(tx, keys);
          if (timesheet) {
            const identity = {
              employeeId: input.employeeId,
              workplaceId: input.workplaceId!,
              month: input.month!,
              year: input.year!,
            };
            const maximum = await tx.timesheet.aggregate({
              where: identity,
              _max: { sequenceNumber: true },
            });
            const sequence = maximum._max.sequenceNumber ?? 0;
            await tx.timesheet.createMany({
              data: files.map((file, index) => ({
                ...identity,
                ...this.fileData(file),
                id: ids[index],
                fileKey: keys[index],
                sequenceNumber: sequence + index + 1,
                uploadedById: auth.id,
              })),
            });
            await this.cleanup.publish(tx, keys);
            const rows = await tx.timesheet.findMany({
              where: { id: { in: ids } },
              include: timesheetInclude,
            });
            const byId = new Map(rows.map((row) => [row.id, row]));
            return ids.map((id) => timesheetDto(byId.get(id)!));
          }
          await tx.document.createMany({
            data: files.map((file, index) => ({
              employeeId: input.employeeId,
              workplaceId: input.workplaceId,
              type: input.type!,
              ...this.fileData(file),
              id: ids[index],
              fileKey: keys[index],
              uploadedById: auth.id,
            })),
          });
          await this.cleanup.publish(tx, keys);
          const rows = await tx.document.findMany({
            where: { id: { in: ids } },
            include: documentInclude,
          });
          const byId = new Map(rows.map((row) => [row.id, row]));
          return ids.map((id) => documentDto(byId.get(id)!));
        },
        { timeout: 15000 },
      );
      if (auth.role !== 'EMPLOYEE') return { created };
      return timesheet
        ? { timesheetIds: ids, message: 'Planillas cargadas correctamente' }
        : { documentIds: ids, message: 'Documentos cargados correctamente' };
    } catch (error) {
      await this.cleanup.compensate(keys);
      throw error;
    }
  }
  private async lockedTimesheet(tx: Prisma.TransactionClient, id: string, version?: number) {
    await tx.$queryRaw`SELECT id FROM "Timesheet" WHERE id=${id}::uuid FOR UPDATE`;
    const row = await tx.timesheet.findUnique({ where: { id } });
    if (!row) notFound();
    if (version !== undefined && row.version !== version)
      throw new ApiException(
        409,
        'FILE_VERSION_CONFLICT',
        'El archivo cambió; recargá los datos antes de reemplazarlo',
      );
    return row;
  }
  async replace(id: string, version: number, auth: AuthenticatedUser, raw: Express.Multer.File[]) {
    const [file] = await validateFiles(raw);
    const identity = await this.db.timesheet.findUnique({
      where: { id },
      select: { employeeId: true, workplaceId: true },
    });
    if (!identity) notFound();
    await this.db.$transaction(async (tx) => {
      await this.context(tx, identity.employeeId, identity.workplaceId);
      await this.lockedTimesheet(tx, id, version);
    });
    const key = `timesheets/${identity.employeeId}/${id}/${randomUUID()}/${file.fileName}`;
    await this.cleanup.journal([key]);
    try {
      await this.push([file], [key]);
      const result = await this.db.$transaction(
        async (tx) => {
          await this.context(tx, identity.employeeId, identity.workplaceId);
          const previous = await this.lockedTimesheet(tx, id, version);
          await this.cleanup.claimPublication(tx, [key]);
          const updated = await tx.timesheet.update({
            where: { id },
            data: {
              ...this.fileData(file),
              fileKey: key,
              status: 'PENDING',
              version: { increment: 1 },
              replacedById: auth.id,
            },
            include: timesheetInclude,
          });
          await this.cleanup.enqueue(tx, previous.fileKey);
          await this.cleanup.publish(tx, [key]);
          return timesheetDto(updated);
        },
        { timeout: 15000 },
      );
      await this.cleanup.tick();
      return result;
    } catch (error) {
      await this.cleanup.compensate([key]);
      throw error;
    }
  }
  async changeStatus(id: string, status: TimesheetStatus) {
    return this.db.$transaction(async (tx) => {
      await this.lockedTimesheet(tx, id);
      return timesheetDto(
        await tx.timesheet.update({
          where: { id },
          data: { status, version: { increment: 1 } },
          include: timesheetInclude,
        }),
      );
    });
  }
  async updateDocument(id: string, data: { type?: DocumentType; fileName?: string }) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Document" WHERE id=${id}::uuid FOR UPDATE`;
      if (!(await tx.document.findUnique({ where: { id } }))) notFound();
      return documentDto(
        await tx.document.update({ where: { id }, data, include: documentInclude }),
      );
    });
  }
  async deleteDocument(id: string) {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Document" WHERE id=${id}::uuid FOR UPDATE`;
      const row = await tx.document.findUnique({ where: { id } });
      if (!row) notFound();
      await this.cleanup.enqueue(tx, row.fileKey);
      await tx.document.delete({ where: { id } });
    });
    await this.cleanup.tick();
  }
}
