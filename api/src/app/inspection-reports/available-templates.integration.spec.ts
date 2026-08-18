/**
 * Integration test — GET /inspection-reports/available-templates (the consumption
 * picker's source). Runs under `test-integration` against the dedicated test Postgres
 * (docker-compose.test.yml → ots_test on 5433), real PrismaService.
 *
 * The endpoint's contract: return every template a report can be created against —
 * ACTIVE AND defined (definitionJson != null), newest version per templateKey, in a
 * MINIMAL shape (templateKey, templateVersion, displayName) that never carries fileBlob
 * or the definitionJson contents. The "available = active AND defined" rule is a
 * server-side WHERE, so an undefined or deprecated template is never offered. These
 * tests pin each arm of that filter and the shape.
 */
import { PrismaService } from '../prisma/prisma.service';
import { InspectionReportsService } from './inspection-reports.service';
import {
  seedTenant,
  seedActiveTemplate,
  resetInspectionDomain,
} from '../../../test/seed-helpers';

/** A minimal but valid-enough definition object (the endpoint only checks non-null). */
const SOME_DEFINITION = {
  formatVersion: 1,
  regions: [],
  fields: [],
  export: { global: [], regions: {} },
};

describe('GET available-templates (consumption picker source) [integration]', () => {
  let prisma: PrismaService;
  let service: InspectionReportsService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    service = new InspectionReportsService(prisma);
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  beforeEach(() => resetInspectionDomain(prisma));

  it('returns a defined+active non-drill-pipe template in a minimal shape', async () => {
    const tenant = await seedTenant(prisma);
    await seedActiveTemplate(prisma, tenant.id, 'CASING_FLAT', {
      definitionJson: SOME_DEFINITION,
    });

    const available = await service.getAvailableTemplates(tenant.id);

    expect(available).toHaveLength(1);
    const t = available[0];
    expect(t.templateKey).toBe('CASING_FLAT');
    expect(t.templateVersion).toBe(1);
    expect(t.displayName).toBe('Casing Flat'); // prettified from the key
    // Minimal shape — no fileBlob, no definitionJson contents leak through.
    expect(Object.keys(t).sort()).toEqual([
      'displayName',
      'templateKey',
      'templateVersion',
    ]);
    expect('fileBlob' in t).toBe(false);
    expect('definitionJson' in t).toBe(false);
  });

  it('does NOT return an undefined (null-definition) template', async () => {
    const tenant = await seedTenant(prisma);
    // ACTIVE but no definition — the load-bearing filter must exclude it.
    await seedActiveTemplate(prisma, tenant.id, 'UNDEFINED_TEMPLATE', {
      definitionJson: null,
    });

    const available = await service.getAvailableTemplates(tenant.id);

    expect(available.map((t) => t.templateKey)).not.toContain(
      'UNDEFINED_TEMPLATE',
    );
    expect(available).toHaveLength(0);
  });

  it('does NOT return a DEPRECATED template even if it is defined', async () => {
    const tenant = await seedTenant(prisma);
    await prisma.template.create({
      data: {
        tenantId: tenant.id,
        templateKey: 'OLD_TEMPLATE',
        templateVersion: 1,
        status: 'DEPRECATED',
        fileBlob: Buffer.from('blob'),
        hash: 'hash-old',
        changeNote: 'seed',
        createdById: 'seed-user',
        definitionJson: SOME_DEFINITION as never,
      },
    });

    const available = await service.getAvailableTemplates(tenant.id);
    expect(available).toHaveLength(0);
  });

  it('returns only the NEWEST active+defined version per templateKey', async () => {
    const tenant = await seedTenant(prisma);
    // A defined key with an older DEPRECATED v1 and a newer ACTIVE v2.
    await prisma.template.create({
      data: {
        tenantId: tenant.id,
        templateKey: 'CASING_FLAT',
        templateVersion: 1,
        status: 'DEPRECATED',
        fileBlob: Buffer.from('b1'),
        hash: 'h1',
        changeNote: 'v1',
        createdById: 'seed-user',
        definitionJson: SOME_DEFINITION as never,
      },
    });
    await prisma.template.create({
      data: {
        tenantId: tenant.id,
        templateKey: 'CASING_FLAT',
        templateVersion: 2,
        status: 'ACTIVE',
        fileBlob: Buffer.from('b2'),
        hash: 'h2',
        changeNote: 'v2',
        createdById: 'seed-user',
        definitionJson: SOME_DEFINITION as never,
      },
    });

    const available = await service.getAvailableTemplates(tenant.id);
    expect(available).toHaveLength(1);
    expect(available[0].templateKey).toBe('CASING_FLAT');
    expect(available[0].templateVersion).toBe(2); // the ACTIVE newest
  });

  it('mixes: returns the defined+active ones, drops undefined and deprecated', async () => {
    const tenant = await seedTenant(prisma);
    await seedActiveTemplate(prisma, tenant.id, 'DRILL_PIPE_REPORT'); // defined by default
    await seedActiveTemplate(prisma, tenant.id, 'CASING_FLAT', {
      definitionJson: SOME_DEFINITION,
    });
    await seedActiveTemplate(prisma, tenant.id, 'NOT_YET_DEFINED', {
      definitionJson: null,
    });

    const available = await service.getAvailableTemplates(tenant.id);
    expect(available.map((t) => t.templateKey).sort()).toEqual([
      'CASING_FLAT',
      'DRILL_PIPE_REPORT',
    ]);
  });
});
