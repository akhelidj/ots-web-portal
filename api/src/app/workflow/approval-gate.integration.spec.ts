/**
 * Integration test — approval-gate wiring, end-to-end through the REAL
 * InspectionReportWorkflowService.transition() against the test Postgres.
 *
 * The legacy null-definition fallback has been RETIRED. This spec now pins the
 * post-retirement contract of the wiring (the Template.definitionJson read +
 * `engineGate` + `enforce`), driving reports IN_INSPECTION → PENDING_APPROVAL:
 *   - ENGINE path (template carries the committed drill-pipe definition):
 *     valid serials approve; a missing required field / disposition throws the
 *     VALIDATION_FAILED 400 with the exact body.
 *   - NULL path (template has definitionJson = NULL): a missing gate definition
 *     is a template-misconfiguration, so the transition throws a PreconditionFailed
 *     (412) naming the template — NOT the user-facing VALIDATION_FAILED.
 * Two DRILL_PIPE_REPORT templates coexist under the same tenant at different
 * templateVersions (v1 = null definition, v2 = definition). The exhaustive
 * per-input matrix lives in the fast unit spec (approval-gate.equivalence.spec.ts);
 * this only pins the plumbing.
 *
 * PENDING_APPROVAL does not trigger the revision snapshot (only APPROVED/reopen
 * do), so RevisionService is stubbed to a no-op.
 */
import { BadRequestException } from '@nestjs/common';
import { InspectionReportStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InspectionReportWorkflowService } from './inspection-report-workflow.service';
import { RevisionService } from '../revision/revision.service';
import { GateDefinition } from './approval-gate';
import { seedTenant, resetInspectionDomain } from '../../../test/seed-helpers';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFINITION = JSON.parse(
  readFileSync(
    resolve(__dirname, '../template/definitions/drill-pipe-v1.definition.json'),
    'utf8',
  ),
) as GateDefinition;

// Required item keys, derived from the committed definition the engine gate reads
// (the deleted DRILL_PIPE_REQUIRED_KEYS const is gone; the seed-helpers mirror is
// unexported). Building a gate-passing serial is input construction, not an oracle.
const REQUIRED_ITEM_KEYS = DEFINITION.fields
  .filter((f) => f.scope === 'item' && f.required === true)
  .map((f) => f.key);

describe('approval gate wiring: engine path + retired-null precondition [integration]', () => {
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
        fileKey: `${tenantId}/DRILL_PIPE_REPORT/${templateVersion}`,
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

  /**
   * All required item keys populated. Disposition resolves from the declared source
   * body.emiResult (also a required item field), set to a real enum value; the legacy
   * final.disposition mirror is not written (single-source — it is inert).
   */
  function fullData(): Record<string, Record<string, unknown>> {
    const d: Record<string, Record<string, unknown>> = {};
    for (const key of REQUIRED_ITEM_KEYS) {
      const [group, field] = key.split('.');
      d[group] ??= {};
      d[group][field] = 1;
    }
    d.body.emiResult = 'PASS';
    return d;
  }

  /** Drive one report IN_INSPECTION → PENDING_APPROVAL; capture ok + enforced body. */
  async function runOne(report: { id: string; tenantId: string; version: number }) {
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
  }

  /**
   * Seed two reports (null-definition v1, definition v2) with IDENTICAL serials,
   * drive both to PENDING_APPROVAL, and return each path's outcome. Post-retirement
   * the two paths NO LONGER agree: the null path throws a 412 precondition error,
   * the engine path runs the gate — so each is asserted against its own contract.
   */
  async function runBothPaths(
    tenantId: string,
    buildSerials: (report: { id: string; tenantId: string }) => Promise<void>,
  ) {
    const rNull = await seedInInspection(tenantId, 1);
    const rDef = await seedInInspection(tenantId, 2);
    await buildSerials(rNull);
    await buildSerials(rDef);
    return { legacy: await runOne(rNull), engine: await runOne(rDef) };
  }

  it('valid serials: engine path approves; null-definition path throws 412 precondition', async () => {
    const tenant = await seedTenant(prisma);
    await seedTemplate(tenant.id, 1, undefined); // definitionJson NULL -> retired path
    await seedTemplate(tenant.id, 2, DEFINITION); // definition -> engine

    const { legacy, engine } = await runBothPaths(tenant.id, async (r) => {
      await seedSerial(r, 'SN-1', fullData());
    });

    // engine path validates and approves
    expect(engine.ok).toBe(true);
    // null path is a template-misconfiguration precondition failure, NOT a gate pass
    expect(legacy.ok).toBe(false);
    expect(legacy.body).toContain('has no gate definition');
    expect(legacy.body).toContain('DRILL_PIPE_REPORT@1');
    expect(legacy.body).not.toContain('VALIDATION_FAILED');
  });

  it('missing required field: engine path throws exact VALIDATION_FAILED 400 body', async () => {
    const tenant = await seedTenant(prisma);
    await seedTemplate(tenant.id, 2, DEFINITION);

    const rDef = await seedInInspection(tenant.id, 2);
    const data = fullData();
    delete data.box.minOD; // drop one required field
    await seedSerial(rDef, 'SN-1', data);
    const engine = await runOne(rDef);

    expect(engine.ok).toBe(false);
    expect(engine.body).toBe(
      '{"code":"VALIDATION_FAILED","message":"Validation failed for one or more serial numbers.","missingDispositionSerials":[],"missingRequiredFields":{"SN-1":["box.minOD"]}}',
    );
  });

  it('missing disposition: engine path throws exact VALIDATION_FAILED 400 body', async () => {
    const tenant = await seedTenant(prisma);
    await seedTemplate(tenant.id, 2, DEFINITION);

    const rDef = await seedInInspection(tenant.id, 2);
    const data = fullData();
    // Clear the declared disposition source. On drill-pipe it is ALSO a required item
    // field, so the failure surfaces on BOTH arrays — the honest single-source outcome.
    delete data.body.emiResult;
    await seedSerial(rDef, 'SN-1', data);
    const engine = await runOne(rDef);

    expect(engine.ok).toBe(false);
    expect(engine.body).toBe(
      '{"code":"VALIDATION_FAILED","message":"Validation failed for one or more serial numbers.","missingDispositionSerials":["SN-1"],"missingRequiredFields":{"SN-1":["body.emiResult"]}}',
    );
  });
});
