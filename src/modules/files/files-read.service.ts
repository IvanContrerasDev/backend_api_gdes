import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { documentDto, documentInclude, timesheetDto, timesheetInclude } from './file-dto';
import { notFound } from './files.errors';
import { FileQuery } from './files.validation';

@Injectable()
export class FilesReadService {
  constructor(
    private readonly db: PrismaService,
    private readonly storage: StorageService,
  ) {}
  async detail(id: string, auth: AuthenticatedUser, timesheet: boolean) {
    return this.db.$transaction(
      async (tx) => {
        if (timesheet) {
          const row = await tx.timesheet.findFirst({
            where: { id, ...(auth.role === 'EMPLOYEE' ? { employeeId: auth.id } : {}) },
            include: timesheetInclude,
          });
          if (!row) notFound();
          return timesheetDto(row);
        }
        const row = await tx.document.findFirst({
          where: { id, ...(auth.role === 'EMPLOYEE' ? { employeeId: auth.id } : {}) },
          include: documentInclude,
        });
        if (!row) notFound();
        return documentDto(row);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async download(id: string, auth: AuthenticatedUser, timesheet: boolean) {
    const where = { id, ...(auth.role === 'EMPLOYEE' ? { employeeId: auth.id } : {}) };
    const row = timesheet
      ? await this.db.timesheet.findFirst({ where, select: { fileKey: true } })
      : await this.db.document.findFirst({ where, select: { fileKey: true } });
    if (!row) notFound();
    return this.storage.getSignedDownloadUrl(row.fileKey);
  }
  async list(query: FileQuery, timesheet: boolean) {
    const conditions: Prisma.Sql[] = [];
    if (query.employeeId) conditions.push(Prisma.sql`f."employeeId"=${query.employeeId}::uuid`);
    const like = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
    if (query.search) {
      const search = like(query.search);
      conditions.push(
        Prisma.sql`(unaccent(f."fileName") ILIKE unaccent(${search}) OR unaccent(u."firstName") ILIKE unaccent(${search}) OR unaccent(u."lastName") ILIKE unaccent(${search}) OR unaccent(u."employeeId") ILIKE unaccent(${search}) OR unaccent(u."firstName" || ' ' || u."lastName") ILIKE unaccent(${search}))`,
      );
    }
    for (const key of ['clientId', 'workplaceId', 'siteId'] as const)
      if (query[key]) {
        const column =
          key === 'workplaceId'
            ? Prisma.sql`f."workplaceId"`
            : key === 'clientId'
              ? Prisma.sql`w."clientId"`
              : Prisma.sql`w."siteId"`;
        conditions.push(Prisma.sql`${column}=${query[key]}::uuid`);
      }
    if (query.month) conditions.push(Prisma.sql`f.month=${query.month}`);
    if (query.year) conditions.push(Prisma.sql`f.year=${query.year}`);
    if (query.status) conditions.push(Prisma.sql`f.status=${query.status}::"TimesheetStatus"`);
    if (query.type) conditions.push(Prisma.sql`f.type=${query.type}::"DocumentType"`);
    if (query.uploadedBy) {
      const search = like(query.uploadedBy);
      conditions.push(
        Prisma.sql`(unaccent(a."firstName") ILIKE unaccent(${search}) OR unaccent(a."lastName") ILIKE unaccent(${search}) OR unaccent(a."firstName" || ' ' || a."lastName") ILIKE unaccent(${search}))`,
      );
    }
    if (query.uploadedFrom)
      conditions.push(
        Prisma.sql`f."createdAt">=(${query.uploadedFrom}::date + INTERVAL '3 hours')`,
      );
    if (query.uploadedTo)
      conditions.push(
        Prisma.sql`f."createdAt"<(${query.uploadedTo}::date + INTERVAL '1 day 3 hours')`,
      );
    const table = timesheet ? Prisma.sql`"Timesheet"` : Prisma.sql`"Document"`;
    const joins = Prisma.sql`JOIN "User" u ON u.id=f."employeeId" JOIN "User" a ON a.id=f."uploadedById" LEFT JOIN "Workplace" w ON w.id=f."workplaceId"`;
    const where = conditions.length
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;
    const order = timesheet
      ? Prisma.sql`f.year DESC, f.month DESC, f."sequenceNumber" DESC, f.id ASC`
      : Prisma.sql`f."createdAt" DESC, f.id ASC`;
    return this.db.$transaction(
      async (tx) => {
        const [{ count }] = await tx.$queryRaw<{ count: bigint }[]>(
          Prisma.sql`SELECT count(*) FROM ${table} f ${joins} ${where}`,
        );
        const ids = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT f.id FROM ${table} f ${joins} ${where} ORDER BY ${order} LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
        );
        const rows = timesheet
          ? (
              await tx.timesheet.findMany({
                where: { id: { in: ids.map((x) => x.id) } },
                include: timesheetInclude,
              })
            ).map(timesheetDto)
          : (
              await tx.document.findMany({
                where: { id: { in: ids.map((x) => x.id) } },
                include: documentInclude,
              })
            ).map(documentDto);
        const byId = new Map(rows.map((row) => [row.id, row]));
        return {
          data: ids.map(({ id }) => byId.get(id)!),
          pagination: {
            page: query.page,
            pageSize: query.pageSize,
            totalItems: Number(count),
            totalPages: Math.ceil(Number(count) / query.pageSize),
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
