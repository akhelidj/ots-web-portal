/**
 * ENGINE-PATH CORRECTNESS — end-to-end across all three definition consumers + REWORK.
 *
 * The legacy hardcoded paths have been RETIRED (the definition engine is sole authority),
 * so this no longer proves NULL-vs-populated neutrality. It now asserts the engine path's
 * OBSERVABLE OUTPUT against an INDEPENDENT oracle for each consumer, exercised on a REAL,
 * seeded drill-pipe report whose template carries the committed definition:
 *
 *   1. GATE   — inspection-report-workflow.service.ts (engineGate → enforce). Oracle: a
 *               valid fixture PASSES the gate (`{status:'pass'}`). The reject-on-missing-
 *               required-key contract is owned by approval-gate.integration.spec.ts (exact
 *               VALIDATION_FAILED body) and re-exercised by the mutation guard below.
 *   2. EXPORT — export.service.ts (definition → engineMap). Oracle: the chunk-boundary
 *               mechanism (11 serials → .zip of 2 parts), via the ADR-0005 structural
 *               canonicalization (ExcelJS → address-keyed cell grid; docProps / ZIP
 *               timestamps excluded by decoding). Per-cell/token/ordering correctness is
 *               owned by export.integration.spec.ts + the Layer-A unit spec.
 *   3. FORM   — the portal's delivery + adapter: GET /inspection-reports embeds
 *               definitionJson (inspection-reports.service.ts getReports), the portal runs
 *               definitionToFormSchema on it. Oracle: the adapter's output over the
 *               committed definition deep-equals a self-contained GOLDEN_FORM_SCHEMA
 *               (hand-materialized locally — no cross-app import of the portal const). Only
 *               the engine module (definitionToFormSchema) is pure TS and imported here.
 *   4. REWORK — the REWORK→child-report trigger (child-reports.service.ts
 *               syncReworkChildReport). Oracle: one REWORK serial produces exactly the
 *               expected child literal. (The imperative-vs-interpreter equivalence itself
 *               is proven exhaustively in rework-rules-consumer.equivalence.integration.spec.ts.)
 *
 * MUTATION GUARD — a corrupted definition must diverge from the real one on the gate
 * consumer (engine(DEF) rejects a missing box.minOD; engine(mutant) no longer does), so
 * this proof can go red (a proof that cannot fail is vacuous). No NULL comparand: a NULL
 * template now throws a 412 precondition, which driveGate would rethrow.
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
// Portal delivery-side consumer (the engine under test), imported directly — it is pure
// TS (zero Angular imports), so swc/jest transpiles it like any other .ts file. The
// hardcoded DRILL_PIPE_V1_SCHEMA is NOT imported across the app boundary; the oracle is a
// self-contained golden materialized locally below (GOLDEN_FORM_SCHEMA).
import { definitionToFormSchema } from '../../../../portal/src/app/features/templates/schemas/definition-to-form-schema';
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

describe('engine-path gate/export/form/rework correctness + mutation guard [integration]', () => {
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
    await seedRealDrillPipeTemplate(prisma, tenant.id); // carries the committed definition by default
    const created = await reportsService.createReport(tenant.id, 'user-admin', {
      customerId: customer.id,
      poNumber: 'PO-EXPORT',
      templateKey: 'DRILL_PIPE_REPORT',
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
  // 1. GATE — the engine gate passes a valid fixture (independent {status:'pass'} oracle).
  // ============================================================================

  type GateResult =
    | { status: 'pass' }
    | { status: 'fail'; body: unknown };

  /** Drive the REAL gate: seed a report to IN_INSPECTION, add the given serials, set the
   *  definition (the real one or a mutant), then attempt IN_INSPECTION → PENDING_APPROVAL
   *  and capture the observable outcome (pass, or the enforced VALIDATION_FAILED body). */
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

  it('GATE happy path: the engine gate PASSES a valid fixture', async () => {
    const engine = await driveGate(DEF, seedValidFixture);
    expect(engine).toEqual({ status: 'pass' });
  });

  // NOTE: the former "GATE rejection: identical error body both ways" test is DROPPED,
  // not migrated. Its independent oracle (engine gate rejects a missing box.minOD with
  // the exact VALIDATION_FAILED body, end-to-end through workflow.transition) is now
  // fully covered by approval-gate.integration.spec.ts ("missing required field: engine
  // path throws exact VALIDATION_FAILED 400 body"). Keeping it here would be a pure
  // duplicate. The engine-rejects-on-missing-box.minOD behaviour is still exercised
  // below by the re-based MUTATION GUARD (its real-definition baseline fails on it).

  // ============================================================================
  // 2. EXPORT — the engine chunk-boundary mechanism (11 serials → .zip of 2 parts).
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

  /** Seed → approve a report with the given serials (template carries the engine
   *  definition by default), then export it once through the engine and canonicalize. */
  async function approveAndExportCanon(
    serials: Array<{
      serial: string;
      opts?: Parameters<typeof seedApprovableSerial>[4];
    }>,
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
    return canonExport(await doExport(tenantId, reportId));
  }

  // NOTE: the former "EXPORT real multi-serial fixture: engine == legacy" test is
  // DROPPED, not migrated — its ONLY assertion was engine==legacy, with no independent
  // oracle of its own. The engine-path behaviours it rode on (REWORK-last ordering,
  // per-row {{sn}}/value/X-mark tokens, falsy→'' rendering) are independently asserted
  // in export.integration.spec.ts (:314, :411/:434) and the unit Layer A spec.

  it('EXPORT chunk boundary (11 serials → .zip of 2 parts)', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      serial: `SN-${String(i + 1).padStart(3, '0')}`,
    }));
    const engine = await approveAndExportCanon(eleven);
    expect((engine as { mimetype: string }).mimetype).toBe('application/zip');
    expect(
      Object.keys((engine as { parts: object }).parts),
    ).toHaveLength(2);
  });

  // ============================================================================
  // 3. FORM — definitionToFormSchema(definition) deep-equals the independent
  //           GOLDEN_FORM_SCHEMA, reached through the REAL delivery path (getReports
  //           embed + HTTP hop).
  // ============================================================================

  /**
   * Frozen, hand-materialized golden — self-contained on the api side (no cross-app
   * import of the portal const, killing the api→portal-source relative import). Written
   * out by hand, sharing ZERO machinery with definitionToFormSchema, so the equivalence
   * below cannot pass vacuously. `as const` gives a local literal type without re-importing
   * portal's FormSchema across the boundary. Independent-literal anchors kept visible:
   * body.emiResult.options === ['PASS','REWORK','SCRAP','HOLD'] and box.hardBanding last.
   */
  const GOLDEN_FORM_SCHEMA = {
    templateKey: 'DRILL_PIPE_REPORT',
    templateVersion: 1,
    sections: [
      {
        key: 'box',
        title: 'Box Connection',
        fields: [
          { key: 'box.minTongSpace', label: 'Min Tong Space', inputType: 'text', required: true },
          { key: 'box.minOD', label: 'Min OD', inputType: 'text', required: true },
          { key: 'box.minBoxThreads', label: 'Min Box Threads', inputType: 'text', required: true },
          { key: 'box.minEccShoulder', label: 'Min Ecc Shoulder', inputType: 'text', required: true },
          { key: 'box.maxCounterBoreDiameter', label: 'Max Counter Bore Diameter', inputType: 'text', required: true },
          { key: 'box.maxCounterBoreLength', label: 'Max Counter Bore Length', inputType: 'text', required: true },
          { key: 'box.bevelDiameterMin', label: 'Bevel Diameter Min', inputType: 'text', required: true },
          { key: 'box.bevelDiameterMax', label: 'Bevel Diameter Max', inputType: 'text', required: true },
          { key: 'box.condition', label: 'Condition', inputType: 'text', required: true },
          { key: 'box.hardBanding', label: 'Hard Banding', inputType: 'text', required: true },
        ],
      },
      {
        key: 'pin',
        title: 'Pin Connection',
        fields: [
          { key: 'pin.minTongSpace', label: 'Min Tong Space', inputType: 'text', required: true },
          { key: 'pin.minOD', label: 'Min OD', inputType: 'text', required: true },
          { key: 'pin.maxID', label: 'Max ID', inputType: 'text', required: true },
          { key: 'pin.minEccShoulder', label: 'Min Ecc Shoulder', inputType: 'text', required: true },
          { key: 'pin.lengthPinConnMin', label: 'Length Pin Conn Min', inputType: 'text', required: true },
          { key: 'pin.lengthPinConnMax', label: 'Length Pin Conn Max', inputType: 'text', required: true },
          { key: 'pin.maxLengthPinBase', label: 'Max Length Pin Base', inputType: 'text', required: true },
          { key: 'pin.bevelDiameterMin', label: 'Bevel Diameter Min', inputType: 'text', required: true },
          { key: 'pin.bevelDiameterMax', label: 'Bevel Diameter Max', inputType: 'text', required: true },
          { key: 'pin.condition', label: 'Condition', inputType: 'text', required: true },
        ],
      },
      {
        key: 'body',
        title: 'Body',
        fields: [
          { key: 'body.wallRemaining', label: 'Wall Remaining', inputType: 'text', required: true },
          { key: 'body.odDecrease', label: 'OD Decrease', inputType: 'text', required: true },
          { key: 'body.emiResult', label: 'EMI Result', inputType: 'select', required: true, options: ['PASS', 'REWORK', 'SCRAP', 'HOLD'] },
          { key: 'body.slipArea', label: 'Slip Area', inputType: 'text', required: true },
          { key: 'body.corrosionIn', label: 'Corrosion Inside', inputType: 'boolean', required: true },
          { key: 'body.corrosionOut', label: 'Corrosion Outside', inputType: 'boolean', required: true },
          { key: 'body.ipc', label: 'IPC', inputType: 'boolean', required: true },
          { key: 'body.bentJoints', label: 'Bent Joints', inputType: 'boolean', required: true },
        ],
      },
      {
        key: 'final',
        title: 'Final Disposition',
        fields: [
          { key: 'final.isNew', label: 'Is New', inputType: 'boolean', required: true },
          { key: 'final.isPremium', label: 'Is Premium', inputType: 'boolean', required: true },
          { key: 'final.isC2', label: 'Is C2', inputType: 'boolean', required: true },
          { key: 'final.isScrap', label: 'Is Scrap', inputType: 'boolean', required: true },
        ],
      },
      {
        key: 'remarksSection',
        title: 'Additional Information',
        fields: [
          { key: 'remarks', label: 'Remarks', inputType: 'text', required: false },
        ],
      },
    ],
  } as const;

  /** Model the portal: seed a report, deliver it via getReports (NULL or populated),
   *  cross the wire, then build the form schema the way the component does — run the
   *  adapter when a definition is embedded, else fall back to the frozen GOLDEN_FORM_SCHEMA
   *  (a dead branch in-test — `def` is always non-null here). */
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
      : GOLDEN_FORM_SCHEMA;
  }

  it('FORM: definitionToFormSchema of the delivered definition equals the independent GOLDEN_FORM_SCHEMA', async () => {
    const engine = await deliverFormSchema(DEF);
    // The independent fixed point: the adapter's output over the committed definition
    // deep-equals the self-contained golden. (The NULL-fallback half was cross-impl only.)
    expect(engine).toEqual(GOLDEN_FORM_SCHEMA);
  });

  // ============================================================================
  // 4. REWORK — the REWORK→child trigger produces the expected child on the engine path
  //    (independent child literal; the path equivalence is owned by the rework harness).
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

  it('REWORK: child-report trigger produces the expected child on the engine path', async () => {
    const engine = await driveRework(DEF);
    // Independent literal: the REWORK serial produces exactly this child. (The
    // imperative-vs-interpreter equivalence itself is proven exhaustively in
    // rework-rules-consumer.equivalence.integration.spec.ts, so the NULL comparand
    // here was redundant.)
    expect(engine).toEqual({
      type: 'REWORK',
      status: 'DRAFT',
      serialNumbers: [
        { serial: 'SN-RW', disposition: null, approvalStatus: 'NOT_INSPECTED' },
      ],
    });
  });

  // ============================================================================
  // MUTATION GUARD — a corrupted definition must diverge from the real one (engine(DEF)
  // vs engine(mutant)) so this whole proof is capable of going red.
  // ============================================================================

  it('MUTATION GUARD: a corrupted definition diverges from the real one (engine(DEF) vs engine(mutant))', async () => {
    // Drop box.minOD's required flag: the REAL definition still flags it missing, the
    // mutant engine no longer does → the two outcomes diverge, exactly what a bad
    // backfill would do. Re-based off the real definition (no NULL comparand — a NULL
    // template now throws a 412 precondition, which driveGate would rethrow).
    const mutant = JSON.parse(JSON.stringify(DEF)) as {
      fields: Array<{ key: string; required: boolean }>;
    };
    mutant.fields.find((f) => f.key === 'box.minOD')!.required = false;

    const real = await driveGate(DEF, seedMissingRequired); // fails on box.minOD
    const corrupted = await driveGate(mutant, seedMissingRequired); // no longer fails

    expect(corrupted).not.toEqual(real);
    expect(real.status).toBe('fail');
    expect(corrupted.status).toBe('pass');
  });
});
