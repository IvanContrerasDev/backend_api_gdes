import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MetricsQuery } from './dashboard.validation';

interface RecordCounts {
  siteId: string;
  incompleteRecords: bigint;
  pendingReviewRecords: bigint;
  recordsWithAbsence: bigint;
}
interface TimesheetCounts {
  siteId: string;
  pendingTimesheets: bigint;
}

@Injectable()
export class DashboardService {
  constructor(private readonly db: PrismaService) {}

  async metrics({ month, year }: MetricsQuery) {
    return this.db.$transaction(
      async (tx) => {
        const sites = await tx.$queryRaw<{ id: string; name: string }[]>`
          SELECT id, name FROM "Site" ORDER BY name COLLATE "C", id`;
        const records = await tx.$queryRaw<RecordCounts[]>`
          SELECT r."siteId",
            COUNT(*) FILTER (WHERE r."recordStatus" = 'INCOMPLETE') AS "incompleteRecords",
            COUNT(*) FILTER (WHERE r."reviewStatus" = 'PENDING') AS "pendingReviewRecords",
            COUNT(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM "Interval" i WHERE i."recordId" = r.id AND i.type = 'ABSENCE'
            )) AS "recordsWithAbsence"
          FROM "AttendanceRecord" r
          WHERE r.date >= make_date(${year}::int, ${month}::int, 1)
            AND r.date < make_date(${year}::int, ${month}::int, 1) + INTERVAL '1 month'
          GROUP BY r."siteId"`;
        const timesheets = await tx.$queryRaw<TimesheetCounts[]>`
          SELECT w."siteId", COUNT(*) AS "pendingTimesheets"
          FROM "Timesheet" t JOIN "Workplace" w ON w.id = t."workplaceId"
          WHERE t.year = ${year} AND t.month = ${month} AND t.status = 'PENDING'
          GROUP BY w."siteId"`;
        const recordsBySite = new Map(records.map((row) => [row.siteId, row]));
        const timesheetsBySite = new Map(timesheets.map((row) => [row.siteId, row]));
        const byProvince = sites.map((site) => {
          const record = recordsBySite.get(site.id);
          return {
            ...site,
            pendingTimesheets: Number(timesheetsBySite.get(site.id)?.pendingTimesheets ?? 0),
            incompleteRecords: Number(record?.incompleteRecords ?? 0),
            pendingReviewRecords: Number(record?.pendingReviewRecords ?? 0),
            recordsWithAbsence: Number(record?.recordsWithAbsence ?? 0),
          };
        });
        const totals = byProvince.reduce(
          (sum, province) => ({
            pendingTimesheets: sum.pendingTimesheets + province.pendingTimesheets,
            incompleteRecords: sum.incompleteRecords + province.incompleteRecords,
            pendingReviewRecords: sum.pendingReviewRecords + province.pendingReviewRecords,
            recordsWithAbsence: sum.recordsWithAbsence + province.recordsWithAbsence,
          }),
          {
            pendingTimesheets: 0,
            incompleteRecords: 0,
            pendingReviewRecords: 0,
            recordsWithAbsence: 0,
          },
        );
        return { ...totals, byProvince };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
