/**
 * Integration test — Phase B1 approval-gate fallback switch, end-to-end through
 * the REAL InspectionReportWorkflowService.transition() against the test Postgres.
 *
 * Proves the wiring (the Template.definitionJson read + the null-definition
 * fallback branch + `enforce`) produces IDENTICAL results whether the gate runs
 * via the legacy path (definitionJson = NULL) or the engine path (the committed
 * drill-pipe definition). Two DRILL_PIPE_REPORT templates coexist under the same
 * tenant at different templateVersions (v1 = null definition, v2 = definition);
 * two reports (one per version) are seeded IN_INSPECTION with IDENTICAL serials
 * and driven to PENDING_APPROVAL. The exhaustive per-input matrix lives in the
 * fast unit spec (approval-gate.equivalence.spec.ts); this only pins the plumbing.
 *
 * PENDING_APPROVAL does not trigger the revision snapshot (only APPROVED/reopen
 * do), so RevisionService is stubbed to a no-op.
 */
import { BadRequestException } from '@nestjs/common';
import { InspectionReportStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InspectionReportWorkflowService } from './inspection-report-workflow.service';
import { RevisionService } from '../revision/revision.service';
import { DRILL_PIPE_REQUIRED_KEYS } from './approval-gate';
import { seedTenant, resetInspectionDomain } from '../../../test/seed-helpers';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFINITION = JSON.parse(
  readFileSync(
    resolve(__dirname, '../template/definitions/drill-pipe-v1.definition.json'),
    'utf8',
  ),
);

describe('approval gate fallback switch (legacy vs engine) [integration]', () => {
  let prisma: PrismaService;
  let workflow: InspectionReportWorkflowService;

  const admin = (tenantId: string) => ({
    id: 'user-admin',
    tenantId,
    role: UserRole.ADMIN,
  });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    const revisionStub = {
      createInspectionReportSnapshot: async () => undefined,
    } as unknown as RevisionService;
    workflow = new InspectionReportWorkflowService(prisma, revisionStub);
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  beforeEach(() => resetInspectionDomain(prisma));

  function seedTemplate(
    tenantId: string,
    templateVersion: number,
    definitionJson: unknown | undefined,
  ) {
    return prisma.template.create({
      data: {
        tenantId,
        templateKey: 'DRILL_PIPE_REPORT',
        templateVersion,
        status: 'ACTIVE',
        fileBlob: Buffer.from(`blob-v${templateVersion}`),
        hash: `hash-v${templateVersion}`,
        changeNote: 'seed',
        createdById: 'seed-user',
        definitionJson: definitionJson as never,
      },
    });
  }

  function seedInInspection(tenantId: string, templateVersion: number) {
    return prisma.inspectionReport.create({
      data: {
        tenantId,
        poNumber: 'PO-GATE',
        templateKey: 'DRILL_PIPE_REPORT',
        templateVersion,
        templateHash: `hash-v${templateVersion}`,
        status: InspectionReportStatus.IN_INSPECTION,
      },
    });
  }

  function seedSerial(
    report: { id: string; tenantId: string },
    serial: string,
    inspectionData: Record<string, unknown>,
  ) {
    return prisma.serialNumber.create({
      data: {
        tenantId: report.tenantId,
        inspectionReportId: report.id,
        serial,
        inspectionData: inspectionData as never,
      },
    });
  }

  /** All 32 required keys populated + a disposition. */
  function fullData(): Record<string, Record<string, unknown>> {
    const d: Record<string, Record<string, unknown>> = {};
    for (const key of DRILL_PIPE_REQUIRED_KEYS) {
      const [group, field] = key.split('.');
      d[group] ??= {};
      d[group][field] = 1;
    }
    d.final.disposition = 'ACCEPT';
    return d;
  }

  /**
   * Seed two reports (null-definition v1, definition v2) with IDENTICAL serials,
   * drive both to PENDING_APPROVAL, and return each path's outcome (ok flag + the
   * enforced HTTP body when it throws).
   */
  async function runBothPaths(
    tenantId: string,
    buildSerials: (report: { id: string; tenantId: string }) => Promise<void>,
  ) {
    const rNull = await seedInInspection(tenantId, 1);
    const rDef = await seedInInspection(tenantId, 2);
    await buildSerials(rNull);
    await buildSerials(rDef);

    const run = async (report: { id: string; tenantId: string; version: number }) => {
      try {
        await workflow.transition(
          admin(report.tenantId),
          report.id,
          InspectionReportStatus.PENDING_APPROVAL,
          report.version,
        );
        return { ok: true, body: null as string | null };
      } catch (e) {
        return {
          ok: false,
          body: JSON.stringify((e as BadRequestException).getResponse()),
        };
      }
    };

    return { legacy: await run(rNull), engine: await run(rDef) };
  }

  it('valid serials: BOTH paths approve (legacy fallback + engine)', async () => {
    const tenant = await seedTenant(prisma);
    await seedTemplate(tenant.id, 1, undefined); // definitionJson NULL -> legacy
    await seedTemplate(tenant.id, 2, DEFINITION); // definition -> engine

    const { legacy, engine } = await runBothPaths(tenant.id, async (r) => {
      await seedSerial(r, 'SN-1', fullData());
    });

    expect(legacy.ok).toBe(true);
    expect(engine.ok).toBe(true);
  });

  it('missing required field: identical HTTP 400 bodies', async () => {
    const tenant = await seedTenant(prisma);
    await seedTemplate(tenant.id, 1, undefined);
    await seedTemplate(tenant.id, 2, DEFINITION);

    const { legacy, engine } = await runBothPaths(tenant.id, async (r) => {
      const data = fullData();
      delete data.box.minOD; // drop one required field
      await seedSerial(r, 'SN-1', data);
    });

    expect(legacy.ok).toBe(false);
    expect(engine.ok).toBe(false);
    expect(engine.body).toBe(legacy.body);
    expect(legacy.body).toBe(
      '{"code":"VALIDATION_FAILED","message":"Validation failed for one or more serial numbers.","missingDispositionSerials":[],"missingRequiredFields":{"SN-1":["box.minOD"]}}',
    );
  });

  it('missing disposition: identical HTTP 400 bodies', async () => {
    const tenant = await seedTenant(prisma);
    await seedTemplate(tenant.id, 1, undefined);
    await seedTemplate(tenant.id, 2, DEFINITION);

    const { legacy, engine } = await runBothPaths(tenant.id, async (r) => {
      const data = fullData();
      delete data.final.disposition; // no disposition anywhere
      await seedSerial(r, 'SN-1', data);
    });

    expect(legacy.ok).toBe(false);
    expect(engine.ok).toBe(false);
    expect(engine.body).toBe(legacy.body);
    expect(legacy.body).toBe(
      '{"code":"VALIDATION_FAILED","message":"Validation failed for one or more serial numbers.","missingDispositionSerials":["SN-1"],"missingRequiredFields":{}}',
    );
  });
});
