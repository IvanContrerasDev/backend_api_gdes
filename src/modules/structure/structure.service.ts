import { HttpStatus, Injectable } from '@nestjs/common';
import { EntityStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { clientInput, fail, ListQuery, workplaceInput } from './structure.validation';

const workplaceInclude = {
  client: { select: { id: true, name: true, status: true } },
  site: { select: { id: true, name: true } },
} as const;
const workplaceSelect = {
  id: true,
  name: true,
  status: true,
  shapeType: true,
  latitude: true,
  longitude: true,
  radiusMeters: true,
  gpsAccuracyThreshold: true,
  createdAt: true,
  updatedAt: true,
  ...workplaceInclude,
} as const;

@Injectable()
export class StructureService {
  constructor(private readonly db: PrismaService) {}
  sites() {
    return this.db.site.findMany({
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }
  async client(id: string) {
    const row = await this.db.client.findUnique({ where: { id } });
    if (!row) fail('CLIENT_NOT_FOUND', 'El cliente no existe', HttpStatus.NOT_FOUND);
    return row;
  }
  async workplace(id: string) {
    const row = await this.db.workplace.findUnique({ where: { id }, select: workplaceSelect });
    if (!row) fail('WORKPLACE_NOT_FOUND', 'El lugar de trabajo no existe', HttpStatus.NOT_FOUND);
    return row;
  }
  async saveClient(input: ReturnType<typeof clientInput>, id?: string) {
    if (id) await this.client(id);
    try {
      return await (id
        ? this.db.client.update({ where: { id }, data: input })
        : this.db.client.create({ data: input }));
    } catch (error) {
      return this.writeError(error, false);
    }
  }
  async clientStatus(id: string, status: EntityStatus) {
    await this.client(id);
    return this.db.client.update({ where: { id }, data: { status } });
  }
  async saveWorkplace(input: ReturnType<typeof workplaceInput>, id?: string) {
    if (id) await this.workplace(id);
    try {
      return await this.db.$transaction(async (tx) => {
        // Always lock Workplace before Client. A concurrent reassignment must not
        // invalidate the historical-client decision while we wait for Client.
        // Client status changes lock only Client, so this order has no reverse path.
        const existing = id
          ? (
              await tx.$queryRaw<{ clientId: string }[]>(
                Prisma.sql`SELECT "clientId" FROM "Workplace" WHERE id = ${id}::uuid FOR UPDATE`,
              )
            )[0]
          : null;
        if (id && !existing)
          fail('WORKPLACE_NOT_FOUND', 'El lugar de trabajo no existe', HttpStatus.NOT_FOUND);
        // Lock the destination client so deactivation cannot race eligibility.

        const clients = await tx.$queryRaw<{ status: EntityStatus }[]>(
          Prisma.sql`SELECT status FROM "Client" WHERE id = ${input.clientId}::uuid FOR UPDATE`,
        );
        if (!clients.length) fail('CLIENT_NOT_FOUND', 'El cliente no existe', HttpStatus.NOT_FOUND);
        if (
          clients[0].status !== EntityStatus.ACTIVE &&
          (!existing || existing.clientId !== input.clientId)
        )
          fail('CLIENT_INACTIVE', 'El cliente está desactivado', HttpStatus.CONFLICT);
        if (!(await tx.site.findUnique({ where: { id: input.siteId } })))
          fail('INVALID_SITE', 'La provincia no existe');
        return id
          ? tx.workplace.update({ where: { id }, data: input, select: workplaceSelect })
          : tx.workplace.create({ data: input, select: workplaceSelect });
      });
    } catch (error) {
      return this.writeError(error, true);
    }
  }
  async workplaceStatus(id: string, status: EntityStatus) {
    await this.workplace(id);
    return this.db.workplace.update({ where: { id }, data: { status }, select: workplaceSelect });
  }
  private writeError(error: unknown, workplace: boolean): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      fail(
        workplace ? 'WORKPLACE_NAME_ALREADY_EXISTS' : 'CLIENT_NAME_ALREADY_EXISTS',
        'El nombre ya está en uso',
        HttpStatus.CONFLICT,
      );
    throw error;
  }
  async mobileWorkplaces() {
    const rows = await this.db.workplace.findMany({
      where: { status: EntityStatus.ACTIVE, client: { status: EntityStatus.ACTIVE } },
      select: {
        id: true,
        name: true,
        siteId: true,
        site: { select: { name: true } },
        client: { select: { name: true } },
        latitude: true,
        longitude: true,
        radiusMeters: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(({ site, client, ...row }) => ({
      ...row,
      siteName: site.name,
      clientName: client.name,
    }));
  }
  async list(query: ListQuery, workplace: boolean) {
    const table = workplace ? Prisma.sql`"Workplace"` : Prisma.sql`"Client"`;
    const conditions: Prisma.Sql[] = [];
    if (query.search) {
      // Escape LIKE metacharacters: search is a literal partial name.
      const search = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push(Prisma.sql`unaccent(name) ILIKE unaccent(${search})`);
    }
    if (query.status) conditions.push(Prisma.sql`status = ${query.status}::"EntityStatus"`);
    if (query.clientId) conditions.push(Prisma.sql`"clientId" = ${query.clientId}::uuid`);
    if (query.siteId) conditions.push(Prisma.sql`"siteId" = ${query.siteId}::uuid`);
    const where = conditions.length
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;
    return this.db.$transaction(
      async (tx) => {
        const [{ count }] = await tx.$queryRaw<{ count: bigint }[]>(
          Prisma.sql`SELECT count(*) FROM ${table} ${where}`,
        );
        const ids = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT id FROM ${table} ${where} ORDER BY name ASC, id ASC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
        );
        const rows = workplace
          ? await tx.workplace.findMany({
              where: { id: { in: ids.map((x) => x.id) } },
              select: workplaceSelect,
            })
          : await tx.client.findMany({ where: { id: { in: ids.map((x) => x.id) } } });
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
