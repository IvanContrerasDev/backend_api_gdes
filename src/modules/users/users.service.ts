import { Injectable } from '@nestjs/common';
import { AccountStatus, Prisma, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/errors/api.exception';
import { PasswordPolicyService } from './password-policy.service';
import { CreateInput, invalid, UserInput, userQuery } from './users.validation';

const listSelect = {
  id: true,
  firstName: true,
  lastName: true,
  employeeId: true,
  dni: true,
  email: true,
  phone: true,
  site: { select: { id: true, name: true } },
  accountStatus: true,
} as const;
const profileSelect = {
  id: true,
  firstName: true,
  lastName: true,
  employeeId: true,
  dni: true,
  email: true,
  phone: true,
  address: true,
  birthDate: true,
  cuil: true,
  hireDate: true,
  position: true,
} as const;
const detailSelect = {
  ...listSelect,
  address: true,
  birthDate: true,
  cuil: true,
  hireDate: true,
  position: true,
  createdAt: true,
  updatedAt: true,
} as const;
function dates<T extends { birthDate: Date; hireDate: Date | null }>(row: T) {
  return {
    ...row,
    birthDate: row.birthDate.toISOString().slice(0, 10),
    hireDate: row.hireDate?.toISOString().slice(0, 10) ?? null,
  };
}
function missing(): never {
  throw new ApiException(404, 'USER_NOT_FOUND', 'El empleado no existe');
}

@Injectable()
export class UsersService {
  constructor(
    private readonly db: PrismaService,
    private readonly passwords: PasswordPolicyService,
  ) {}
  async detail(id: string) {
    const row = await this.db.user.findFirst({
      where: { id, role: UserRole.EMPLOYEE },
      select: detailSelect,
    });
    if (!row) missing();
    return dates(row);
  }
  async profile(id: string) {
    const row = await this.db.user.findFirst({
      where: { id, role: UserRole.EMPLOYEE },
      select: profileSelect,
    });
    if (!row) missing();
    return dates(row);
  }
  private async site(siteId: string | undefined) {
    if (
      siteId !== undefined &&
      !(await this.db.site.findUnique({ where: { id: siteId }, select: { id: true } }))
    )
      invalid('INVALID_SITE');
  }
  async create(input: CreateInput) {
    this.passwords.validate(input.initialPassword);
    await this.site(input.siteId);
    const { initialPassword, ...data } = input;
    const passwordHash = await argon2.hash(initialPassword);
    try {
      return dates(
        await this.db.user.create({
          data: {
            ...data,
            passwordHash,
            role: UserRole.EMPLOYEE,
            accountStatus: AccountStatus.ACTIVE,
            emailVerifiedAt: new Date(),
          },
          select: detailSelect,
        }),
      );
    } catch (error) {
      return this.writeError(error);
    }
  }
  async update(id: string, input: UserInput) {
    await this.detail(id);
    await this.site(input.siteId);
    try {
      return dates(
        await this.db.user.update({
          where: { id, role: UserRole.EMPLOYEE },
          data: input,
          select: detailSelect,
        }),
      );
    } catch (error) {
      return this.writeError(error);
    }
  }
  async status(id: string, accountStatus: AccountStatus) {
    return this.db.$transaction(async (tx) => {
      // Auth rotation and OTP verification acquire User before sessions. Holding
      // this lock also serializes newly issued sessions; never snapshot session ids.
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "User" WHERE id=${id}::uuid AND role='EMPLOYEE' FOR UPDATE`;
      if (!rows.length) missing();
      const row = await tx.user.update({
        where: { id },
        data: { accountStatus },
        select: detailSelect,
      });
      if (accountStatus === AccountStatus.INACTIVE)
        await tx.authSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      return dates(row);
    });
  }
  private writeError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const target = JSON.stringify(error.meta?.target ?? '');
        const code = target.includes('dni')
          ? 'USER_DNI_ALREADY_EXISTS'
          : target.includes('employeeId')
            ? 'USER_EMPLOYEE_ID_ALREADY_EXISTS'
            : 'USER_EMAIL_ALREADY_EXISTS';
        throw new ApiException(409, code, 'La identidad del empleado ya está en uso');
      }
      if (error.code === 'P2025') missing();
      if (error.code === 'P2003') invalid('INVALID_SITE');
    }
    throw error;
  }
  async list(query: ReturnType<typeof userQuery>) {
    const where: Prisma.UserWhereInput = {
      role: UserRole.EMPLOYEE,
      accountStatus: query.accountStatus,
    };
    if (query.search) {
      const contains = query.search.replace(/[\\%_]/g, '\\$&');
      where.OR = ['firstName', 'lastName', 'email', 'employeeId', 'dni'].map((field) => ({
        [field]: { contains, mode: 'insensitive' },
      }));
    }
    return this.db.$transaction(
      async (tx) => {
        const totalItems = await tx.user.count({ where });
        const data = await tx.user.findMany({
          where,
          select: listSelect,
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
          take: query.pageSize,
          skip: (query.page - 1) * query.pageSize,
        });
        return {
          data,
          pagination: {
            page: query.page,
            pageSize: query.pageSize,
            totalItems,
            totalPages: Math.ceil(totalItems / query.pageSize),
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
