import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Declares which roles may access a route, e.g. `@Roles('ADMIN', 'SUPER_ADMIN')`.
 * Role values come from the `UserRole` enum (docs/02-modelo-de-datos.md).
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
