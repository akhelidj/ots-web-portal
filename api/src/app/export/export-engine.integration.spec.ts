/**
 * Layer B — Phase B2 export STRUCTURAL equivalence (integration, real template).
 *
 * Exports the SAME approved report twice through the real ExportService — once with
 * the template's definitionJson NULL (→ legacy mapDrillPipeReportV1) and once with
 * the committed drill-pipe definition attached (→ engine engineMap) — and asserts
 * the two outputs are structurally identical via `canonExport`.
 *
 * `canonExport` decodes the workbook(s) with ExcelJS and compares cell text keyed by
 * address, per-sheet maxRow, and merges (plus filename/mimetype and, for zips, each
 * part). Decoding NEVER reads docProps timestamps or ZIP entry metadata, so the
 * ADR-0005 volatile bits are excluded by construction; because both exports read the
 * same frozen snapshot on the same machine, reportNumber/reportDate/inspectedBy are
 * also stable and get compared. See docs/adr/0005-export-determinism-structural-only.md.
 *
 * The exhaustive per-token/transform matrix lives in the unit Layer A spec; this
 * pins the row-expansion / ordering / chunking mechanism end-to-end + the four guards.
 */
import { InspectionReportStatus, UserRole } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { ExportService } from './export.service';
import { RevisionService } from '../revision/revision.service';
import { InspectionReportWorkflowService } from '../workflow/inspection-report-workflow.service';
import { InspectionReportsService } from '../inspection-reports/inspection-reports.service';
import {
  seedTenant,
  seedCustomer,
  seedRealDrillPipeTemplate,
  seedApprovableSerial,
  resetInspectionDomain,
} from '../../../test/seed-helpers';

const DEF = JSON.parse(
  readFileSync(
    resolve(__dirname, '../template/definitions/drill-pipe-v1.definition.json'),
    'utf8',
  ),
);

describe('Layer B — export engine vs legacy structural equivalence [integration]', () => {
  let prisma: PrismaService;
  let exportService: ExportService;
  let workflow: InspectionReportWorkflowService;
  let reports: InspectionReportsService;

  const admin = (tenantId: string) => ({
    id: 'user-admin',
    tenantId,
    role: UserRole.ADMIN,
  });
  const exportUser = (tenantId: string) => ({
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
    reports = new InspectionReportsService(prisma);
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  beforeEach(() => resetInspectionDomain(prisma));

  // --- setup: approve a report (template definitionJson = NULL) with serials -----

  async function approveWithSerials(
    serials: Array<{
      serial: string;
      opts?: Parameters<typeof seedApprovableSerial>[4];
    }>,
  ) {
    const tenant = await seedTenant(prisma);
    const customer = await seedCustomer(prisma, tenant.id);
    await seedRealDrillPipeTemplate(prisma, tenant.id); // definitionJson stays NULL
    const created = await reports.createReport(tenant.id, 'user-admin', {
      customerId: customer.id,
      poNumber: 'PO-EXPORT',
    });
    const a = admin(tenant.id);
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
    for (const s of serials) {
      await seedApprovableSerial(prisma, tenant.id, created.id, s.serial, s.opts);
    }
    const pending = await workflow.transition(
      a,
      created.id,
      InspectionReportStatus.PENDING_APPROVAL,
      r.version,
    );
    await workflow.transition(
      a,
      created.id,
      InspectionReportStatus.APPROVED,
      pending.version,
    );
    return { tenant, reportId: created.id };
  }

  const doExport = (tenantId: string, reportId: string) =>
    exportService.exportInspectionReport(exportUser(tenantId), reportId);

  function setDefinition(tenantId: string, definition: unknown) {
    return prisma.template.updateMany({
      where: { tenantId, templateKey: 'DRILL_PIPE_REPORT' },
      data: { definitionJson: definition as never },
    });
  }

  // --- canonicalization (volatiles excluded by decoding) ------------------------

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
      if ('result' in anyV) return anyV.result == null ? null : String(anyV.result);
      if ('text' in anyV) return String(anyV.text);
      return null;
    }
    return String(v);
  }

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
        ((ws as unknown as { model?: { merges?: string[] } }).model?.merges) ??
        []
      )
        .slice()
        .sort();
      return { name: ws.name, maxRow, cells, merges };
    });
  }

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

  /** Change only volatile bytes (docProps timestamp) — content untouched. */
  async function rewriteVolatile(buffer: Buffer): Promise<Buffer> {
    const zip = await JSZip.loadAsync(buffer as unknown as ArrayBuffer);
    const core = await zip.file('docProps/core.xml')?.async('string');
    if (core) {
      const mutated = core.replace(
        /(<dcterms:modified[^>]*>)([^<]*)(<\/dcterms:modified>)/,
        `$12000-01-01T00:00:00Z$3`,
      );
      zip.file(
        'docProps/core.xml',
        mutated !== core ? mutated : core + '<!-- volatile -->',
      );
    } else {
      zip.file('docProps/_volatile.txt', String(Date.now()));
    }
    return (await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    })) as Buffer;
  }

  /** Export legacy (def NULL), attach a definition, export engine; return both canon. */
  async function legacyVsEngine(tenantId: string, reportId: string, definition = DEF) {
    const legacyRes = await doExport(tenantId, reportId);
    await setDefinition(tenantId, definition);
    const engineRes = await doExport(tenantId, reportId);
    return {
      legacy: await canonExport(legacyRes),
      engine: await canonExport(engineRes),
    };
  }

  // --- equivalence cases --------------------------------------------------------

  it('B1 single serial: engine == legacy', async () => {
    const { tenant, reportId } = await approveWithSerials([{ serial: 'SN-001' }]);
    const { legacy, engine } = await legacyVsEngine(tenant.id, reportId);
    expect(engine).toEqual(legacy);
  });

  it('B2 multiple serials incl. REWORK (ordering preserved): engine == legacy', async () => {
    const { tenant, reportId } = await approveWithSerials([
      { serial: 'SN-003', opts: { disposition: 'ACCEPT' } },
      { serial: 'SN-001', opts: { disposition: 'ACCEPT' } },
      { serial: 'SN-002', opts: { disposition: 'REWORK' } },
    ]);
    const { legacy, engine } = await legacyVsEngine(tenant.id, reportId);
    expect(engine).toEqual(legacy);
  });

  it('B3 chunk boundary: 10 serials → single .xlsx, engine == legacy', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({
      serial: `SN-${String(i + 1).padStart(3, '0')}`,
    }));
    const { tenant, reportId } = await approveWithSerials(ten);
    const { legacy, engine } = await legacyVsEngine(tenant.id, reportId);
    expect((engine as { mimetype: string }).mimetype).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(engine).toEqual(legacy);
  });

  it('B4 chunk boundary: 11 serials → .zip of 2 parts, engine == legacy', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      serial: `SN-${String(i + 1).padStart(3, '0')}`,
    }));
    const { tenant, reportId } = await approveWithSerials(eleven);
    const { legacy, engine } = await legacyVsEngine(tenant.id, reportId);
    expect((engine as { mimetype: string }).mimetype).toBe('application/zip');
    expect(Object.keys((engine as { parts: object }).parts).sort()).toEqual([
      'OTS_PO-EXPORT_' +
        (await topReportNumber(prisma, reportId)) +
        '_1_part1of2.xlsx',
      'OTS_PO-EXPORT_' +
        (await topReportNumber(prisma, reportId)) +
        '_1_part2of2.xlsx',
    ]);
    expect(engine).toEqual(legacy);
  });

  // --- mutation / soundness guards ----------------------------------------------

  it('GUARD 1 transform mutation is detected (boolCheckbox X→Y)', async () => {
    const { tenant, reportId } = await approveWithSerials([{ serial: 'SN-001' }]);
    const mutant = JSON.parse(JSON.stringify(DEF));
    mutant.transforms.boolCheckbox.whenTrue = 'Y'; // jc_new 'X' → 'Y'
    const { legacy, engine } = await legacyVsEngine(tenant.id, reportId, mutant);
    expect(engine).not.toEqual(legacy);
  });

  it('GUARD 2 token-mapping mutation is detected ({{b_od}} → different field)', async () => {
    const { tenant, reportId } = await approveWithSerials([
      { serial: 'SN-001', opts: { boxMinOD: 'BOD-DISTINCT' } },
    ]);
    const mutant = JSON.parse(JSON.stringify(DEF));
    mutant.export.regions.serials.find(
      (e: { token: string }) => e.token === '{{b_od}}',
    ).field = 'box.minID'; // resolves empty → different cell than box.minOD
    const { legacy, engine } = await legacyVsEngine(tenant.id, reportId, mutant);
    expect(engine).not.toEqual(legacy);
  });

  it('GUARD 3 chunkSize mutation is detected (5 → 3 parts vs 2)', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      serial: `SN-${String(i + 1).padStart(3, '0')}`,
    }));
    const { tenant, reportId } = await approveWithSerials(eleven);
    const mutant = JSON.parse(JSON.stringify(DEF));
    mutant.regions[0].chunkSize = 5; // 11 → 3 parts, vs legacy 2
    const { legacy, engine } = await legacyVsEngine(tenant.id, reportId, mutant);
    expect(engine).not.toEqual(legacy);
  });

  it('GUARD 4 normalization soundness: volatile-only byte diff ignored; same mapper twice → equal canon', async () => {
    const { tenant, reportId } = await approveWithSerials([{ serial: 'SN-001' }]);

    // (a) same mapper (legacy) twice → identical canon
    const a = await doExport(tenant.id, reportId);
    const b = await doExport(tenant.id, reportId);
    expect(await canonExport(a)).toEqual(await canonExport(b));

    // (b) a volatile-only byte change is ignored by canon, though the bytes differ
    const variant = await rewriteVolatile(a.buffer);
    expect(Buffer.compare(a.buffer, variant)).not.toBe(0); // raw bytes differ
    expect(await canon(variant)).toEqual(await canon(a.buffer)); // canon identical
  });

  async function topReportNumber(p: PrismaService, reportId: string) {
    const r = await p.inspectionReport.findUnique({
      where: { id: reportId },
      select: { reportNumber: true },
    });
    return r?.reportNumber;
  }
});
