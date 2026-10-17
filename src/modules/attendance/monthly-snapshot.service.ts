import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Prisma } from '@prisma/client';
import { ApiException } from '../../common/errors/api.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { MonthlyQuery } from './records.validation';

type Totals = { monthWorkMinutes: number; matchingWorkMinutes: number };
type Day =
  | { date: string; state: 'EMPTY' }
  | {
      date: string;
      state: 'PRESENT';
      matchesFilters: boolean;
      record: {
        id: string;
        totalWorkMinutes: number;
        recordStatus: string;
        reviewStatus: string;
        origin: string;
        hasAbsence: boolean;
        intervalCount: number;
      };
    };
export interface MonthlyRow {
  employee: { id: string; firstName: string; lastName: string; employeeId: string };
  workplace: { id: string; name: string };
  client: { id: string; name: string };
  site: { id: string; name: string };
  days: Day[];
  totals: Totals;
}
interface Payload {
  rows: MonthlyRow[];
  totals: Totals;
}
const order = 'lastName:C,firstName:C,workplaceName:C,userId,workplaceId';
function context(q: MonthlyQuery) {
  const { page: _page, snapshotToken: _token, ...filters } = q;
  void _page;
  void _token;
  return JSON.stringify({
    filters: Object.fromEntries(Object.entries(filters).sort(([a], [b]) => a.localeCompare(b))),
    order,
  });
}
function expired(): never {
  throw new ApiException(
    410,
    'MONTHLY_SNAPSHOT_EXPIRED',
    'La consulta mensual venció; iniciá una nueva consulta',
  );
}
function mismatch(): never {
  throw new ApiException(
    400,
    'MONTHLY_SNAPSHOT_MISMATCH',
    'El snapshot no corresponde a esta consulta',
  );
}
@Injectable()
export class MonthlySnapshotService {
  constructor(private readonly db: PrismaService) {}
  async monthly(ownerId: string, q: MonthlyQuery) {
    const key = context(q);
    let snapshot;
    if (q.snapshotToken) {
      if (!isUUID(q.snapshotToken)) expired();
      snapshot = await this.db.monthlySnapshot.findUnique({
        where: { id: q.snapshotToken.toLowerCase() },
      });
      if (!snapshot || snapshot.expiresAt.getTime() <= Date.now()) expired();
      if (snapshot.ownerId !== ownerId || snapshot.context !== key) mismatch();
    } else {
      if (q.page !== 1) mismatch();
      // Cleanup is technical and uses READ COMMITTED independently. Keeping it
      // inside RepeatableRead makes concurrent DELETEs of one expired row
      // produce a serialization failure unrelated to the monthly read.
      await this.db.monthlySnapshot.deleteMany({ where: { expiresAt: { lte: new Date() } } });
      snapshot = await this.db.$transaction(
        async (tx) => {
          const createdAt = new Date(),
            expiresAt = new Date(createdAt.getTime() + 900000);
          const start = new Date(
            `${String(q.year).padStart(4, '0')}-${String(q.month).padStart(2, '0')}-01T00:00:00.000Z`,
          );
          const end = new Date(start);
          end.setUTCMonth(end.getUTCMonth() + 1);
          const conditions = [Prisma.sql`r.date >= ${start}::date AND r.date < ${end}::date`];
          if (q.employeeId) conditions.push(Prisma.sql`r."userId"=${q.employeeId}::uuid`);
          if (q.workplaceId) conditions.push(Prisma.sql`r."workplaceId"=${q.workplaceId}::uuid`);
          if (q.clientId) conditions.push(Prisma.sql`r."clientId"=${q.clientId}::uuid`);
          if (q.siteId) conditions.push(Prisma.sql`r."siteId"=${q.siteId}::uuid`);
          // C collation is applied by PostgreSQL, never approximated by localeCompare.
          const ids = await tx.$queryRaw<{ id: string }[]>(
            Prisma.sql`SELECT r.id FROM "AttendanceRecord" r JOIN "User" u ON u.id=r."userId" JOIN "Workplace" w ON w.id=r."workplaceId" WHERE ${Prisma.join(conditions, ' AND ')} ORDER BY u."lastName" COLLATE "C",u."firstName" COLLATE "C",w.name COLLATE "C",r."userId",r."workplaceId",r.date`,
          );
          const records = await tx.attendanceRecord.findMany({
            where: { id: { in: ids.map((i) => i.id) } },
            select: {
              id: true,
              date: true,
              totalWorkMinutes: true,
              recordStatus: true,
              reviewStatus: true,
              origin: true,
              userId: true,
              workplaceId: true,
              user: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
              workplace: { select: { id: true, name: true } },
              client: { select: { id: true, name: true } },
              site: { select: { id: true, name: true } },
              intervals: { select: { type: true } },
            },
          });
          const byId = new Map(records.map((r) => [r.id, r]));
          const groups = new Map<string, typeof records>();
          for (const { id } of ids) {
            const r = byId.get(id)!;
            const k = r.userId + ':' + r.workplaceId;
            const list = groups.get(k) ?? [];
            list.push(r);
            groups.set(k, list);
          }
          const rows: MonthlyRow[] = [];
          const totals: Totals = { monthWorkMinutes: 0, matchingWorkMinutes: 0 };
          const dayCount = new Date(end.getTime() - 86400000).getUTCDate();
          for (const group of groups.values()) {
            const matches = (r: (typeof records)[number]) =>
              (!q.status || r.recordStatus === q.status) &&
              (!q.reviewStatus || r.reviewStatus === q.reviewStatus) &&
              (!q.origin || r.origin === q.origin) &&
              (!q.hasAbsence || r.intervals.some((i) => i.type === 'ABSENCE'));
            if (!group.some(matches)) continue;
            const first = group[0],
              rowTotals: Totals = { monthWorkMinutes: 0, matchingWorkMinutes: 0 };
            const days: Day[] = Array.from({ length: dayCount }, (_, index) => {
              const date = `${String(q.year).padStart(4, '0')}-${String(q.month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`;
              const r = group.find((r) => r.date.toISOString().slice(0, 10) === date);
              if (!r) return { date, state: 'EMPTY' };
              const matching = matches(r);
              rowTotals.monthWorkMinutes += r.totalWorkMinutes;
              if (matching) rowTotals.matchingWorkMinutes += r.totalWorkMinutes;
              return {
                date,
                state: 'PRESENT',
                matchesFilters: matching,
                record: {
                  id: r.id,
                  totalWorkMinutes: r.totalWorkMinutes,
                  recordStatus: r.recordStatus,
                  reviewStatus: r.reviewStatus,
                  origin: r.origin,
                  hasAbsence: r.intervals.some((i) => i.type === 'ABSENCE'),
                  intervalCount: r.intervals.length,
                },
              };
            });
            rows.push({
              employee: first.user,
              workplace: first.workplace,
              client: first.client,
              site: first.site,
              days,
              totals: rowTotals,
            });
            totals.monthWorkMinutes += rowTotals.monthWorkMinutes;
            totals.matchingWorkMinutes += rowTotals.matchingWorkMinutes;
          }
          const payload = { rows, totals };
          return tx.monthlySnapshot.create({
            data: {
              ownerId,
              context: key,
              payload: payload as unknown as Prisma.InputJsonObject,
              createdAt,
              expiresAt,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
      );
    }
    const payload = snapshot.payload as unknown as Payload;
    return {
      data: payload.rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
      pagination: {
        page: q.page,
        pageSize: q.pageSize,
        totalItems: payload.rows.length,
        totalPages: Math.ceil(payload.rows.length / q.pageSize),
      },
      meta: {
        month: q.month,
        year: q.year,
        timeZone: '-03:00',
        snapshotToken: snapshot.id,
        snapshotExpiresAt: snapshot.expiresAt.toISOString(),
        totals: payload.totals,
      },
    };
  }
}
