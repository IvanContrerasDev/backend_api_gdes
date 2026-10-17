import { Prisma } from '@prisma/client';
export const personSelect = { id: true, firstName: true, lastName: true } as const;
const employeeSelect = { ...personSelect, employeeId: true } as const;
export const timesheetInclude = {
  employee: { select: employeeSelect },
  workplace: {
    select: {
      id: true,
      name: true,
      client: { select: { id: true, name: true } },
      site: { select: { id: true, name: true } },
    },
  },
  uploadedBy: { select: personSelect },
  replacedBy: { select: personSelect },
} as const;
export const documentInclude = {
  employee: { select: employeeSelect },
  workplace: { select: { id: true, name: true } },
  uploadedBy: { select: personSelect },
} as const;
export function timesheetDto(
  row: Prisma.TimesheetGetPayload<{ include: typeof timesheetInclude }>,
) {
  return {
    id: row.id,
    employee: row.employee,
    workplace: { id: row.workplace.id, name: row.workplace.name },
    client: row.workplace.client,
    site: row.workplace.site,
    month: row.month,
    year: row.year,
    sequence: row.sequenceNumber,
    status: row.status,
    fileName: row.fileName,
    fileExtension: row.fileExtension,
    fileSizeBytes: row.fileSizeBytes,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
    replacedBy: row.replacedBy,
  };
}
export function documentDto(row: Prisma.DocumentGetPayload<{ include: typeof documentInclude }>) {
  return {
    id: row.id,
    employee: row.employee,
    workplace: row.workplace,
    type: row.type,
    fileName: row.fileName,
    fileExtension: row.fileExtension,
    fileSizeBytes: row.fileSizeBytes,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
