import { Controller, Get } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('catalogs')
export class CatalogsController {
  constructor(private readonly db: PrismaService) {}
  @Get() async catalogs() {
    const reasons = {
      ILLNESS: 'Enfermedad',
      VACATION: 'Vacaciones',
      LEAVE: 'Licencia',
      ART: 'ART',
      OTHER: 'Otros',
    };
    const types = {
      DNI: 'DNI',
      MEDICAL_CERTIFICATE: 'Certificado médico',
      CONTRACT: 'Contrato',
      ART: 'ART',
      EPP_DOCUMENTATION: 'Documentación EPP',
      MEDICAL_RECORD: 'Ficha médica',
      INTERNAL_RULES: 'Normas internas',
      ADDRESS_DECLARATION: 'Declaración de domicilio',
      OTHER: 'Otros',
    };
    const sites = await this.db.$queryRaw<{ id: string; name: string }[]>(
      Prisma.sql`SELECT id,name FROM "Site" ORDER BY name COLLATE "C",id`,
    );
    return {
      absenceReasons: Object.entries(reasons).map(([value, label]) => ({ value, label })),
      documentTypes: Object.entries(types).map(([value, label]) => ({ value, label })),
      sites: sites.map((site) => ({ value: site.id, label: site.name })),
    };
  }
}
