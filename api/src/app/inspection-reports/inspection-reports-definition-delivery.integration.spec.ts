/**
 * Integration test — Phase B3 delivery: GET /inspection-reports embeds each
 * report's template definitionJson (joined from the Template it pins).
 *
 * Pins two facts: (1) with no definition on the template (every row today) each
 * report carries definitionJson === null → the portal falls back to its hardcoded
 * schema; (2) once a definition is attached to the Template, the same report now
 * carries it. Runs against the dedicated test Postgres.
 */
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InspectionReportsService } from './inspection-reports.service';
import {
  seedTenant,
  seedActiveTemplate,
  seedInspectionReport,
  resetInspectionDomain,
} from '../../../test/seed-helpers';

describe('getReports embeds template definitionJson [integration]', () => {
  let prisma: PrismaService;
  let service: InspectionReportsService;

  const admin = (tenantId: string) => ({
    tenantId,
    role: UserRole.ADMIN,
    customerId: null,
  });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    service = new InspectionReportsService(prisma);
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  beforeEach(() => resetInspectionDomain(prisma));

  it('carries definitionJson === null when the template has none (every report today)', async () => {
    const tenant = await seedTenant(prisma);
    // Deliberate NULL: this test asserts the null-definition delivery contract, so it
    // opts out of the seeder's definition-carrying default.
    await seedActiveTemplate(prisma, tenant.id, 'DRILL_PIPE_REPORT', {
      definitionJson: null,
    });
    await seedInspectionReport(prisma, tenant.id);

    const reports = await service.getReports(admin(tenant.id));

    expect(reports).toHaveLength(1);
    expect(
      (reports[0] as { definitionJson: unknown }).definitionJson,
    ).toBeNull();
  });

  it('carries the definitionJson once attached to the template', async () => {
    const tenant = await seedTenant(prisma);
    // Starts NULL (opt out of the default), then a definition is attached below — the
    // "once attached" contract this test pins.
    await seedActiveTemplate(prisma, tenant.id, 'DRILL_PIPE_REPORT', {
      definitionJson: null,
    });
    await seedInspectionReport(prisma, tenant.id);
    const definition = { formatVersion: 1, templateKey: 'DRILL_PIPE_REPORT' };
    await prisma.template.updateMany({
      where: { tenantId: tenant.id, templateKey: 'DRILL_PIPE_REPORT' },
      data: { definitionJson: definition as never },
    });

    const reports = await service.getReports(admin(tenant.id));

    expect(
      (reports[0] as { definitionJson: unknown }).definitionJson,
    ).toEqual(definition);
  });

  // Phase D step 2 — the generic header store must survive the list-endpoint
  // projection, or a full re-pull → IndexedDB hydrate would drop the header overlay
  // (the portal pull stores each returned report verbatim). getReports uses an
  // unrestricted findMany (no `select`) + `{ ...r, definitionJson }`, so the whole
  // row — headerData included — is carried. This pins that read-path completion.
  it('carries the generic headerData map through the list projection', async () => {
    const tenant = await seedTenant(prisma);
    await seedActiveTemplate(prisma, tenant.id, 'DRILL_PIPE_REPORT');
    const report = await seedInspectionReport(prisma, tenant.id);

    const headerData = {
      grade: 'S-135',
      certNumber: 'CERT-7788', // a NON-column field — only reachable via headerData
      equipmentUsed: [{ name: 'UT Gauge', number: 'UT-9' }],
    };
    await prisma.inspectionReport.update({
      where: { id: report.id },
      data: { headerData },
    });

    const reports = await service.getReports(admin(tenant.id));

    expect(reports).toHaveLength(1);
    expect((reports[0] as { headerData: unknown }).headerData).toEqual(
      headerData,
    );
  });
});
