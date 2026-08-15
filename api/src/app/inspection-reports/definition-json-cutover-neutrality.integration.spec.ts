/**
 * CUTOVER ACCEPTANCE TEST — end-to-end OUTPUT NEUTRALITY across all three consumers.
 *
 * Step 3 (definition-json-cutover-roundtrip.integration.spec.ts) proved the committed
 * definition SURVIVES a real DB write→read on every delivery path. This is the final
 * gate: it proves the OBSERVABLE OUTPUT of all three definition consumers is identical
 * whether Template.definitionJson is NULL (→ legacy hardcoded path) or populated from
 * the committed file (→ definition engine) — exercised on a REAL, seeded drill-pipe
 * report, through the REAL wired dispatch (`definition ? engine : legacy`) that each
 * consumer already ships:
 *
 *   1. GATE   — inspection-report-workflow.service.ts:307-329
 *               (`definition ? engineGate(...) : legacyGate(...)` → enforce).
 *   2. EXPORT — export.service.ts:282-346 (definition passed into generateExcelFiles;
 *               legacy mapDrillPipeReportV1 vs engine engineMap). Compared with the B2
 *               Layer-B structural canonicalization (ExcelJS → address-keyed cell grid;
 *               ADR-0005 volatiles — docProps / ZIP timestamps — excluded by decoding).
 *   3. FORM   — the portal's own delivery + adapter: GET /inspection-reports embeds
 *               definitionJson (inspection-reports.service.ts getReports), the portal
 *               runs definitionToFormSchema on it when present, else falls back to the
 *               hardcoded DRILL_PIPE_V1_SCHEMA. Both portal modules are pure TS and are
 *               imported directly here. (This is the B3 assertion, re-run in the
 *               populated-vs-NULL frame.)
 *   4. REWORK — sanity, NOT equivalence: the REWORK→child-report trigger
 *               (child-reports.service.ts syncReworkChildReport) keys off
 *               inspectionData.body.emiResult and NEVER reads definitionJson, so the
 *               flip cannot affect it. Asserted explicitly so the cutover demonstrates
 *               REWORK is untouched by the engine flip.
 *
 * MUTATION GUARD — on the gate consumer, a corrupted populated definition makes the
 * populated-vs-NULL comparison FAIL, so this proof can go red (a proof that cannot
 * fail is vacuous).
 *
 * Runs against the dedicated test Postgres (:5433) under maxWorkers:1. Seeds only
 * `_test` rows; NEVER touches the real dev/prod template row and commits nothing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  InspectionReportStatus,
  SerialDisposition,
  UserRole,
} from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PrismaService } from '../prisma/prisma.service';
import { ExportService } from '../export/export.service';
import { RevisionService } from '../revision/revision.service';
import { InspectionReportWorkflowService } from '../workflow/inspection-report-workflow.service';
import { InspectionReportsService } from './inspection-reports.service';
import { ChildReportsService } from '../child-reports/child-reports.service';
import { ReworkRulesInterpreter } from '../child-reports/rework-rules.interpreter';
import type { FilesService } from '../files/files.service';
// Portal delivery-side consumer, imported directly (both modules are pure TS —
// zero Angular imports — so swc/jest transpiles them like any other .ts file).
import { definitionToFormSchema } from '../../../../portal/src/app/features/templates/schemas/definition-to-form-schema';
import { DRILL_PIPE_V1_SCHEMA } from '../../../../portal/src/app/features/templates/schemas/drill-pipe-v1.schema';
import {
  seedTenant,
  seedCustomer,
  seedRealDrillPipeTemplate,
  seedApprovableSerial,
  seedInspectionReport,
  resetInspectionDomain,
} from '../../../test/seed-helpers';

const TEMPLATE_KEY = 'DRILL_PIPE_REPORT';
const DEFINITION_PATH = resolve(
  __dirname,
  '../template/definitions/drill-pipe-v1.definition.json',
);

/** The committed definition — the value the backfill would write into the column. */
function committedDefinition(): Record<string, unknown> {
  return JSON.parse(readFileSync(DEFINITION_PATH, 'utf8'));
}
const DEF = committedDefinition();

/** The one realistic multi-serial drill-pipe fixture used by gate + export. It
 *  deliberately exercises the false-is-valid and REWORK paths:
 *   - SN-001: fully valid, jacket flags TRUE  → {{jc_*}} render 'X'.
 *   - SN-002: jacket flags FALSE (0) + box.minOD '0' → false/'0' kept, still gate-valid.
 *   - SN-003: REWORK disposition                → export orders it last. */
const REAL_FIXTURE: Array<{
  serial: string;
  opts?: Parameters<typeof seedApprovableSerial>[4];
}> = [
  { serial: 'SN-001' },
  { serial: 'SN-002', opts: { finalFlags: false, boxMinOD: '0' } },
  { serial: 'SN-003', opts: { disposition: SerialDisposition.REWORK } },
];

describe('definitionJson cutover output-neutrality [integration]', () => {
  let prisma: PrismaService;
  let exportService: ExportService;
  let workflow: InspectionReportWorkflowService;
  let reportsService: InspectionReportsService;
  let childReports: ChildReportsService;

  const actor = (tenantId: string) => ({
    id: 'user-admin',
    tenantId,
    role: UserRole.ADMIN,
  });
  const viewer = (tenantId: string) => ({
    tenantId,
    role: UserRole.ADMIN,
    customerId: null,
  });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    const revisionService = new RevisionService(prisma);
    exportService = new ExportService(prisma, revisionService);
    workflow = new InspectionReportWorkflowService(prisma, revisionService);
    reportsService = new InspectionReportsService(prisma);
    // syncReworkChildReport never touches FilesService — a stub satisfies the ctor.
    childReports = new ChildReportsService(
      prisma,
      {} as FilesService,
      new ReworkRulesInterpreter(prisma),
    );
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  beforeEach(() => resetInspectionDomain(prisma));

  // --- shared seeding -----------------------------------------------------------

  /** Attach (or clear) the committed definition on the tenant's drill-pipe template —
   *  the SAME write the backfill performs. `def === null` leaves the column NULL. */
  function setDefinition(tenantId: string, def: unknown) {
    return prisma.template.updateMany({
      where: { tenantId, templateKey: TEMPLATE_KEY },
      data: { definitionJson: def as never },
    });
  }

  /** Create a report and climb DRAFT → IN_INSPECTION (no serials yet — the gate only
   *  fires on → PENDING_APPROVAL). Uses the REAL drill-pipe xlsx so export can render. */
  async function seedInInspection() {
    const tenant = await seedTenant(prisma);
    const customer = await seedCustomer(prisma, tenant.id);
    await seedRealDrillPipeTemplate(prisma, tenant.id); // definitionJson starts NULL
    const created = await reportsService.createReport(tenant.id, 'user-admin', {
      customerId: customer.id,
      poNumber: 'PO-EXPORT',
    });
    const a = actor(tenant.id);
    let r = await workflow.transition(
      a,
      created.id,
      InspectionReportStatus.RECEIVED,
      created.version,
    );
    r = await workflow.transition(
      a,
      created.id,
      InspectionReportStatus.READY_FOR_CLEANING,
      r.version,
    );
    r = await workflow.transition(
      a,
      created.id,
      InspectionReportStatus.READY_FOR_INSPECTION,
      r.version,
    );
    r = await workflow.transition(
      a,
      created.id,
      InspectionReportStatus.IN_INSPECTION,
      r.version,
    );
    return { tenantId: tenant.id, reportId: created.id, version: r.version };
  }

  // ============================================================================
  // 1. GATE — same approval-gate outcome (pass/fail + error body) both ways.
  // ============================================================================

  type GateResult =
    | { status: 'pass' }
    | { status: 'fail'; body: unknown };

  /** Drive the REAL gate: seed a report to IN_INSPECTION, add the given serials, set
   *  the definition (or leave NULL), then attempt IN_INSPECTION → PENDING_APPROVAL and
   *  capture the observable outcome (pass, or the enforced VALIDATION_FAILED body). */
  async function driveGate(
    def: unknown,
    seedSerials: (tenantId: string, reportId: string) => Promise<void>,
  ): Promise<GateResult> {
    const { tenantId, reportId, version } = await seedInInspection();
    await seedSerials(tenantId, reportId);
    if (def !== null) await setDefinition(tenantId, def);
    try {
      await workflow.transition(
        actor(tenantId),
        reportId,
        InspectionReportStatus.PENDING_APPROVAL,
        version,
      );
      return { status: 'pass' };
    } catch (e) {
      if (!(e instanceof BadRequestException)) throw e;
      return { status: 'fail', body: e.getResponse() };
    }
  }

  const seedValidFixture = async (tenantId: string, reportId: string) => {
    for (const s of REAL_FIXTURE) {
      await seedApprovableSerial(prisma, tenantId, reportId, s.serial, s.opts);
    }
  };

  /** The valid fixture, but SN-002 has a required key (box.minOD) removed → the gate
   *  must reject it identically on both sides. */
  const seedMissingRequired = async (tenantId: string, reportId: string) => {
    const s = await seedApprovableSerial(prisma, tenantId, reportId, 'SN-BAD');
    const data = s.inspectionData as { box: Record<string, unknown> };
    delete data.box.minOD;
    await prisma.serialNumber.update({
      where: { id: s.id },
      data: { inspectionData: data as never },
    });
  };

  it('GATE happy path: NULL (legacy) and populated (engine) both PASS identically', async () => {
    const legacy = await driveGate(null, seedValidFixture);
    const engine = await driveGate(DEF, seedValidFixture);
    expect(engine).toEqual(legacy);
    expect(engine).toEqual({ status: 'pass' });
  });

  it('GATE rejection: missing required key rejected with an IDENTICAL error body both ways', async () => {
    const legacy = await driveGate(null, seedMissingRequired);
    const engine = await driveGate(DEF, seedMissingRequired);
    expect(engine).toEqual(legacy);
    // pin the shared rejection shape (order-sensitive: JSON.stringify)
    expect(engine.status).toBe('fail');
    expect(JSON.stringify((engine as { body: unknown }).body)).toBe(
      '{"code":"VALIDATION_FAILED","message":"Validation failed for one or more serial numbers.","missingDispositionSerials":[],"missingRequiredFields":{"SN-BAD":["box.minOD"]}}',
    );
  });

  // ============================================================================
  // 2. EXPORT — structurally-canonical xlsx equal both ways.
  // ============================================================================

  /** Read a cell's text, collapsing ExcelJS's richText / formula-result shapes. */
  function readCellText(cell: ExcelJS.Cell): string | null {
    const v = cell.value;
    if (v == null) return null;
    if (typeof v === 'object') {
      const anyV = v as Record<string, unknown>;
      if (Array.isArray(anyV.richText)) {
        return (anyV.richText as Array<{ text: string }>)
          .map((rt) => rt.text)
          .join('');
      }
      if ('result' in anyV)
        return anyV.result == null ? null : String(anyV.result);
      if ('text' in anyV) return String(anyV.text);
      return null;
    }
    return String(v);
  }

  /** Decode one workbook to { name, maxRow, address→text cells, merges }. Never reads
   *  docProps timestamps or ZIP metadata, so ADR-0005 volatiles are excluded here. */
  async function canon(buffer: Buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    return wb.worksheets.map((ws) => {
      const cells: Record<string, string> = {};
      let maxRow = 0;
      ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          const t = readCellText(cell);
          if (t != null && t !== '') {
            cells[cell.address] = t;
            if (rowNumber > maxRow) maxRow = rowNumber;
          }
        });
      });
      const merges = (
        (ws as unknown as { model?: { merges?: string[] } }).model?.merges ?? []
      )
        .slice()
        .sort();
      return { name: ws.name, maxRow, cells, merges };
    });
  }

  /** Canonicalize an export result — a single .xlsx, or a .zip of parts. */
  async function canonExport(res: {
    filename: string;
    mimetype: string;
    buffer: Buffer;
  }) {
    if (res.mimetype === 'application/zip') {
      const zip = await JSZip.loadAsync(res.buffer as unknown as ArrayBuffer);
      const names = Object.keys(zip.files).sort();
      const parts: Record<string, unknown> = {};
      for (const name of names) {
        const buf = (await zip.files[name].async('nodebuffer')) as Buffer;
        parts[name] = await canon(buf);
      }
      return { filename: res.filename, mimetype: res.mimetype, parts };
    }
    return {
      filename: res.filename,
      mimetype: res.mimetype,
      sheets: await canon(res.buffer),
    };
  }

  const doExport = (tenantId: string, reportId: string) =>
    exportService.exportInspectionReport(viewer(tenantId), reportId);

  /** Seed → approve a report with the given serials (definitionJson stays NULL), then
   *  export it twice: once legacy (NULL), once with `def` attached (engine). Export is
   *  read-only, so the SAME approved report is reused for both — no re-seed. */
  async function exportLegacyVsEngine(
    serials: Array<{
      serial: string;
      opts?: Parameters<typeof seedApprovableSerial>[4];
    }>,
    def: unknown = DEF,
  ) {
    const { tenantId, reportId, version } = await seedInInspection();
    for (const s of serials) {
      await seedApprovableSerial(prisma, tenantId, reportId, s.serial, s.opts);
    }
    const pending = await workflow.transition(
      actor(tenantId),
      reportId,
      InspectionReportStatus.PENDING_APPROVAL,
      version,
    );
    await workflow.transition(
      actor(tenantId),
      reportId,
      InspectionReportStatus.APPROVED,
      pending.version,
    );

    const legacyRes = await doExport(tenantId, reportId); // definitionJson NULL
    await setDefinition(tenantId, def);
    const engineRes = await doExport(tenantId, reportId); // engine
    return {
      legacy: await canonExport(legacyRes),
      engine: await canonExport(engineRes),
    };
  }

  it('EXPORT real multi-serial fixture (incl. false/0 + REWORK): engine == legacy', async () => {
    const { legacy, engine } = await exportLegacyVsEngine(REAL_FIXTURE);
    expect(engine).toEqual(legacy);
  });

  it('EXPORT chunk boundary (11 serials → .zip of 2 parts): engine == legacy', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      serial: `SN-${String(i + 1).padStart(3, '0')}`,
    }));
    const { legacy, engine } = await exportLegacyVsEngine(eleven);
    expect((engine as { mimetype: string }).mimetype).toBe('application/zip');
    expect(
      Object.keys((engine as { parts: object }).parts),
    ).toHaveLength(2);
    expect(engine).toEqual(legacy);
  });

  // ============================================================================
  // 3. FORM — definitionToFormSchema(populated) deep-equals legacy DRILL_PIPE_V1_SCHEMA,
  //           reached through the REAL delivery path (getReports embed + HTTP hop).
  // ============================================================================

  /** Model the portal: seed a report, deliver it via getReports (NULL or populated),
   *  cross the wire, then build the form schema the way the component does — run the
   *  adapter when a definition is embedded, else fall back to the hardcoded schema. */
  async function deliverFormSchema(def: unknown) {
    const tenant = await seedTenant(prisma);
    await seedRealDrillPipeTemplate(prisma, tenant.id);
    await seedInspectionReport(prisma, tenant.id);
    if (def !== null) await setDefinition(tenant.id, def);

    const reports = await reportsService.getReports(viewer(tenant.id));
    const overTheWire = JSON.parse(JSON.stringify(reports)) as Array<{
      definitionJson: unknown;
    }>;
    const embedded = overTheWire[0].definitionJson;
    return embedded
      ? definitionToFormSchema(embedded as never)
      : DRILL_PIPE_V1_SCHEMA;
  }

  it('FORM: NULL (legacy schema) == populated (definitionToFormSchema of the delivered definition)', async () => {
    const legacy = await deliverFormSchema(null);
    const engine = await deliverFormSchema(DEF);
    expect(engine).toEqual(legacy);
    // both equal the independent fixed point (not merely each other)
    expect(engine).toEqual(DRILL_PIPE_V1_SCHEMA);
  });

  // ============================================================================
  // 4. REWORK sanity — the REWORK→child trigger is unaffected by the flip (it never
  //    reads definitionJson). Trivially equal by construction; asserted explicitly.
  // ============================================================================

  /** Seed a report with one REWORK serial (body.emiResult = REWORK — the trigger's
   *  sole input), optionally attach the definition, run syncReworkChildReport, and
   *  return the child response reduced to its structural core (ids/timestamps stripped). */
  async function driveRework(def: unknown) {
    const tenant = await seedTenant(prisma);
    await seedRealDrillPipeTemplate(prisma, tenant.id);
    const report = await seedInspectionReport(prisma, tenant.id, {
      status: InspectionReportStatus.IN_INSPECTION,
    });
    await prisma.serialNumber.create({
      data: {
        tenantId: tenant.id,
        inspectionReportId: report.id,
        serial: 'SN-RW',
        inspectionData: {
          body: { emiResult: SerialDisposition.REWORK },
        } as never,
      },
    });
    if (def !== null) await setDefinition(tenant.id, def);

    const child = await childReports.syncReworkChildReport(tenant.id, report.id);
    if (!child) return null;
    // Strip identity/volatile fields; keep only what REWORK semantics produce.
    return {
      type: child.type,
      status: child.status,
      serialNumbers: child.serialNumbers.map((sn) => ({
        serial: sn.serial,
        disposition: sn.disposition,
        approvalStatus: sn.approvalStatus,
      })),
    };
  }

  it('REWORK: child-report trigger produces an IDENTICAL child both ways', async () => {
    const legacy = await driveRework(null);
    const engine = await driveRework(DEF);
    expect(engine).toEqual(legacy);
    // and it actually fired (guards against two vacuous nulls passing)
    expect(engine).toEqual({
      type: 'REWORK',
      status: 'DRAFT',
      serialNumbers: [
        { serial: 'SN-RW', disposition: null, approvalStatus: 'NOT_INSPECTED' },
      ],
    });
  });

  // ============================================================================
  // MUTATION GUARD — a corrupted populated definition must make the populated-vs-NULL
  // comparison FAIL, so this whole proof is capable of going red.
  // ============================================================================

  it('MUTATION GUARD: a corrupted definition breaks gate neutrality (populated != NULL)', async () => {
    // Drop box.minOD's required flag: legacy still flags it missing, the mutant engine
    // no longer does → the two outcomes diverge, exactly what a bad backfill would do.
    const mutant = JSON.parse(JSON.stringify(DEF)) as {
      fields: Array<{ key: string; required: boolean }>;
    };
    mutant.fields.find((f) => f.key === 'box.minOD')!.required = false;

    const legacy = await driveGate(null, seedMissingRequired); // fails on box.minOD
    const corrupted = await driveGate(mutant, seedMissingRequired); // no longer fails

    expect(corrupted).not.toEqual(legacy);
    expect(legacy.status).toBe('fail');
    expect(corrupted.status).toBe('pass');
  });
});
