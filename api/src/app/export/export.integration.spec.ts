/**
 * Integration test — the deterministic xlsx export path (ExportService +
 * the definition-driven engine mapper). Runs under the `test-integration` target against the
 * dedicated test Postgres (docker-compose.test.yml → ots_test on 5433). Real
 * ExportService/RevisionService/workflow, real persistence, and the REAL tracked
 * template fixture (api/scripts/valid-template.xlsx) loaded as the Template blob.
 *
 * BASELINE we are locking: the export's *deterministic* observable contract — the
 * return shape (filename/mimetype), approval gating, serial ordering, chunking→zip
 * boundary, revision resolution, and token substitution into cells. Foundation
 * behavior that must stay unchanged. Stable/untagged — not a known bug. See
 * docs/adr/0005-export-determinism-structural-only.md for the determinism scoping.
 *
 * STRATEGY (confirmed): structural assertions on the DECODED workbook — never a
 * golden-file, byte, or hash comparison. The xlsx is a zip of OOXML that embeds
 * non-deterministic timestamps in docProps/core.xml (ExcelJS) and in per-entry ZIP
 * mod-times (JSZip zip.file without a date, xlsx-token-engine.ts / export.service.ts),
 * so byte/hash equality is flaky BY CONSTRUCTION. We decode and assert on values.
 *
 * DELIBERATE DETERMINISM-SCOPING (exclusions are intentional, not gaps):
 *  - {{reportDate}}     — new Date(updatedAt).toLocaleDateString(): wall-clock + locale.
 *  - {{inspectedBy}} / {{approvedBy}} — resolved from transition-log userIds → User
 *    rows we don't seed, so they land on 'N/A'; user-dependent, not pinned.
 *  - reportNumber from the live create path is <PREFIX>-YYMMDD-HHMMSS (wall-clock),
 *    so we overwrite it with a fixed value before approval to pin the filename.
 *  - Raw bytes / buffer hashes — never asserted (see STRATEGY).
 *
 * TOKEN COVERAGE IN THIS FIXTURE (established empirically from sharedStrings.xml):
 *  - Substitutable AND asserted: {{customer}} {{poNumber}} {{reportNumber}}
 *    {{grade}} {{range}} {{weight}} {{connection}} {{nomWT}} {{nomOD}} {{nomID}}
 *    {{standardUsed}} {{inspectionAddress}} {{inspectorComment}} and the per-row
 *    {{sn}} / {{b_od}} / {{jc_new}} tokens.
 *  - Present in the mapping but NOT substitutable in this fixture (absent from the
 *    template) — NOT asserted: {{b_cbd}}, {{remarks}}.
 *  - Substitutable but excluded for determinism (above): {{reportDate}},
 *    {{inspectedBy}}, {{approvedBy}}. ({{equipment}}/{{methods}} resolve to the
 *    literal 'None specified' when unseeded — deterministic but not a seeded value,
 *    so not asserted.)
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { InspectionReportStatus, UserRole } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import JSZip from 'jszip';
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

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('Deterministic xlsx export (foundation baseline) [integration]', () => {
  let prisma: PrismaService;
  let exportService: ExportService;
  let workflow: InspectionReportWorkflowService;
  let reports: InspectionReportsService;

  const admin = (tenantId: string) => ({
    id: 'user-admin',
    tenantId,
    role: UserRole.ADMIN,
  });
  const adminExportUser = (tenantId: string) => ({
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

  // Distinctive, collision-proof seed values so `cells.includes(x)` is meaningful.
  const HEADER_SEED = {
    reportNumber: 'RPT-EXPORT-1',
    grade: 'GR-X95',
    range: 'RANGE-R2',
    weight: 'WT-26',
    connection: 'CONN-NC50',
    nomWT: 'NWT-0362',
    nomOD: 'NOD-55',
    nomID: 'NID-4778',
    standardUsed: 'STD-DS1',
    inspectionAddress: 'ADDR-HOUSTON',
    inspectorComment: 'CMT-ALLGOOD',
  };

  /** Seed a DRAFT report with the real template and pinned, distinctive header fields. */
  async function newSeededDraft() {
    const tenant = await seedTenant(prisma);
    const customer = await seedCustomer(prisma, tenant.id);
    await seedRealDrillPipeTemplate(prisma, tenant.id);
    const created = await reports.createReport(tenant.id, 'user-admin', {
      customerId: customer.id,
      poNumber: 'PO-EXPORT',
      templateKey: 'DRILL_PIPE_REPORT',
    });
    // Pin reportNumber (create path timestamps it) + distinctive header values, all
    // BEFORE approval so the first-approval snapshot captures them. Does not touch
    // `version`, so the transition chain below still starts from version 1.
    //
    // Phase D step 3 — the header fields are seeded into the generic `headerData`
    // store (not the retired named columns); `reportNumber` stays a real metadata
    // column. This is a DATA-SOURCE move only: the assertions below read the same
    // HEADER_SEED values, which now reach the export via headerData → snapshot.header
    // (walkPath) instead of the deleted column bridge — structurally identical output.
    const { reportNumber, ...headerFields } = HEADER_SEED;
    const report = await prisma.inspectionReport.update({
      where: { id: created.id },
      data: { reportNumber, headerData: headerFields },
    });
    return { tenant, customer, report };
  }

  /** Drive DRAFT→IN_INSPECTION, seed the given serials, then →PENDING_APPROVAL→APPROVED. */
  async function approveWithSerials(
    serials: Array<{
      serial: string;
      opts?: Parameters<typeof seedApprovableSerial>[4];
    }>,
  ) {
    const { tenant, report } = await newSeededDraft();
    const a = admin(tenant.id);
    let r = await workflow.transition(
      a,
      report.id,
      InspectionReportStatus.RECEIVED,
      report.version,
    );
    r = await workflow.transition(
      a,
      report.id,
      InspectionReportStatus.READY_FOR_CLEANING,
      r.version,
    );
    r = await workflow.transition(
      a,
      report.id,
      InspectionReportStatus.READY_FOR_INSPECTION,
      r.version,
    );
    r = await workflow.transition(
      a,
      report.id,
      InspectionReportStatus.IN_INSPECTION,
      r.version,
    );
    for (const s of serials) {
      await seedApprovableSerial(
        prisma,
        tenant.id,
        report.id,
        s.serial,
        s.opts,
      );
    }
    const pending = await workflow.transition(
      a,
      report.id,
      InspectionReportStatus.PENDING_APPROVAL,
      r.version,
    );
    await workflow.transition(
      a,
      report.id,
      InspectionReportStatus.APPROVED,
      pending.version,
    );
    return { tenant, reportId: report.id };
  }

  // --- decode helpers (never touch raw bytes for assertions) --------------------

  /**
   * Resolve a cell to plain text WITHOUT using cell.text — the template has merged
   * cells whose master value is null, and ExcelJS's cell.text getter throws
   * (MergeValue.toString) on those. Reading cell.value is null-safe for merge slaves.
   */
  function readCellText(cell: ExcelJS.Cell): string | null {
    const v = cell.value;
    if (v == null) return null;
    if (typeof v === 'object') {
      // richText / formula-result / hyperlink; merge slaves already returned null.
      const anyV = v as Record<string, unknown>;
      if (Array.isArray(anyV.richText)) {
        return (anyV.richText as Array<{ text: string }>)
          .map((r) => r.text)
          .join('');
      }
      if ('result' in anyV)
        return anyV.result == null ? null : String(anyV.result);
      if ('text' in anyV) return String(anyV.text);
      return null;
    }
    return String(v);
  }

  async function loadSheet(buffer: Buffer): Promise<ExcelJS.Worksheet> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    return wb.worksheets[0];
  }

  /** Flatten every cell to its resolved text. */
  async function allCellTexts(buffer: Buffer): Promise<string[]> {
    const ws = await loadSheet(buffer);
    const out: string[] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const t = readCellText(cell);
        if (t != null && t !== '') out.push(t);
      });
    });
    return out;
  }

  /** Serial values (SN-\d+) in worksheet row order — reflects export ordering. */
  async function serialRowOrder(buffer: Buffer): Promise<string[]> {
    const ws = await loadSheet(buffer);
    const order: string[] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const t = readCellText(cell);
        if (t && /^SN-\d+$/.test(t)) order.push(t);
      });
    });
    return order;
  }

  /** The full set of cell texts for the data row that contains `serial`. */
  async function rowTextsFor(
    buffer: Buffer,
    serial: string,
  ): Promise<string[]> {
    const ws = await loadSheet(buffer);
    let found: string[] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const texts: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const t = readCellText(cell);
        if (t != null) texts.push(t);
      });
      if (texts.includes(serial)) found = texts;
    });
    return found;
  }

  // --- orchestration contract ---------------------------------------------------

  it('returns a single .xlsx with the deterministic filename + mimetype', async () => {
    const { tenant, reportId } = await approveWithSerials([
      { serial: 'SN-001' },
    ]);

    const res = await exportService.exportInspectionReport(
      adminExportUser(tenant.id),
      reportId,
    );

    // OTS_<PO upper/underscored>_<reportNumber>_<revisionNumber>.xlsx (:288/:352-358).
    // revisionNumber defaults to report.revisionNumber, which is 1 after first approval.
    expect(res.filename).toBe('OTS_PO-EXPORT_RPT-EXPORT-1_1.xlsx');
    expect(res.mimetype).toBe(XLSX_MIME);
    expect(Buffer.isBuffer(res.buffer)).toBe(true);
  });

  it('refuses export unless the report is APPROVED/CLOSED (ForbiddenException)', async () => {
    // A DRAFT report — no approved parent, no approved child → gate closed (:76-80).
    const { tenant, report } = await newSeededDraft();
    await expect(
      exportService.exportInspectionReport(
        adminExportUser(tenant.id),
        report.id,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Once APPROVED, the same call succeeds.
    const { tenant: t2, reportId } = await approveWithSerials([
      { serial: 'SN-001' },
    ]);
    const res = await exportService.exportInspectionReport(
      adminExportUser(t2.id),
      reportId,
    );
    expect(res.mimetype).toBe(XLSX_MIME);
  });

  it('orders parent serials REWORK-last, others serial-ascending (:296-307)', async () => {
    const { tenant, reportId } = await approveWithSerials([
      { serial: 'SN-003', opts: { disposition: 'ACCEPT' } },
      { serial: 'SN-001', opts: { disposition: 'ACCEPT' } },
      { serial: 'SN-002', opts: { disposition: 'REWORK' } },
    ]);

    const res = await exportService.exportInspectionReport(
      adminExportUser(tenant.id),
      reportId,
    );
    const order = await serialRowOrder(res.buffer);

    // Non-REWORK first (ascending): SN-001, SN-003; then REWORK last: SN-002.
    expect(order).toEqual(['SN-001', 'SN-003', 'SN-002']);
  });

  it('chunks at 10: 10 serials → single .xlsx; 11 → a .zip of _part1of2/_part2of2', async () => {
    // Boundary: N <= 10 stays a single file (generateExcelFiles :391).
    const ten = Array.from({ length: 10 }, (_, i) => ({
      serial: `SN-${String(i + 1).padStart(3, '0')}`,
    }));
    const a = await approveWithSerials(ten);
    const resTen = await exportService.exportInspectionReport(
      adminExportUser(a.tenant.id),
      a.reportId,
    );
    expect(resTen.mimetype).toBe(XLSX_MIME);
    expect(resTen.filename.endsWith('.xlsx')).toBe(true);

    // N = 11 → ceil(11/10) = 2 parts → zipped (:410-441, :362-372).
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      serial: `SN-${String(i + 1).padStart(3, '0')}`,
    }));
    const b = await approveWithSerials(eleven);
    const resEleven = await exportService.exportInspectionReport(
      adminExportUser(b.tenant.id),
      b.reportId,
    );
    expect(resEleven.mimetype).toBe('application/zip');
    expect(resEleven.filename).toBe('OTS_PO-EXPORT_RPT-EXPORT-1_1.zip');

    const zip = await JSZip.loadAsync(
      resEleven.buffer as unknown as ArrayBuffer,
    );
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual([
      'OTS_PO-EXPORT_RPT-EXPORT-1_1_part1of2.xlsx',
      'OTS_PO-EXPORT_RPT-EXPORT-1_1_part2of2.xlsx',
    ]);
  });

  it('resolves the revision source: default → report.revisionNumber; missing revision → NotFound', async () => {
    const { tenant, reportId } = await approveWithSerials([
      { serial: 'SN-001' },
    ]);

    // Default (no revision arg) resolves to report.revisionNumber (= 1), which the
    // filename's trailing segment reflects (:288).
    const def = await exportService.exportInspectionReport(
      adminExportUser(tenant.id),
      reportId,
    );
    expect(def.filename.endsWith('_1.xlsx')).toBe(true);

    // An explicit, non-existent revision → NotFoundException (:161).
    await expect(
      exportService.exportInspectionReport(
        adminExportUser(tenant.id),
        reportId,
        99,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // --- content: token substitution into cells -----------------------------------

  it('substitutes global header tokens with seeded values (fixture-present tokens only)', async () => {
    const { tenant, reportId } = await approveWithSerials([
      { serial: 'SN-001' },
    ]);
    const res = await exportService.exportInspectionReport(
      adminExportUser(tenant.id),
      reportId,
    );
    const cells = await allCellTexts(res.buffer);
    // Substring, not exact-equal: several header tokens are embedded inline with a
    // label in the template (e.g. the {{grade}} cell reads "Grade: {{grade}}"), so
    // the resolved cell is "Grade: GR-X95". The distinctive seed values make a
    // substring match unambiguous.
    const has = (v: string) => cells.some((c) => c.includes(v));

    expect(has('Acme Drilling')).toBe(true); // {{customer}} ← report.customer.name
    expect(has('PO-EXPORT')).toBe(true); // {{poNumber}}
    expect(has(HEADER_SEED.reportNumber)).toBe(true); // {{reportNumber}}
    expect(has(HEADER_SEED.grade)).toBe(true); // {{grade}}
    expect(has(HEADER_SEED.range)).toBe(true); // {{range}}
    expect(has(HEADER_SEED.weight)).toBe(true); // {{weight}}
    expect(has(HEADER_SEED.connection)).toBe(true); // {{connection}}
    expect(has(HEADER_SEED.nomWT)).toBe(true); // {{nomWT}}
    expect(has(HEADER_SEED.nomOD)).toBe(true); // {{nomOD}}
    expect(has(HEADER_SEED.nomID)).toBe(true); // {{nomID}}
    expect(has(HEADER_SEED.standardUsed)).toBe(true); // {{standardUsed}}
    expect(has(HEADER_SEED.inspectionAddress)).toBe(true); // {{inspectionAddress}}
    expect(has(HEADER_SEED.inspectorComment)).toBe(true); // {{inspectorComment}}

    // No populated token is left unresolved in any cell (scoped to cell text, not
    // raw XML, so orphaned template shared-strings are irrelevant).
    expect(cells.some((c) => c.includes('{{'))).toBe(false);
  });

  it('expands the {{sn}} row per serial and resolves per-row value + X-mark tokens', async () => {
    const { tenant, reportId } = await approveWithSerials([
      // Distinctive box.minOD → {{b_od}}; final flags ON → {{jc_new}} = 'X'.
      { serial: 'SN-001', opts: { boxMinOD: 'BOD-9875' } },
      // final flags OFF → this row's {{jc_*}} render '' (no 'X').
      { serial: 'SN-002', opts: { finalFlags: false } },
    ]);
    const res = await exportService.exportInspectionReport(
      adminExportUser(tenant.id),
      reportId,
    );

    // Two serials → two data rows.
    const order = await serialRowOrder(res.buffer);
    expect(order).toEqual(['SN-001', 'SN-002']);

    // Row 1: distinctive numeric field resolved, and an 'X' present (jc flags on).
    const row1 = await rowTextsFor(res.buffer, 'SN-001');
    expect(row1).toContain('BOD-9875'); // {{b_od}}
    expect(row1).toContain('X'); // {{jc_new}} (final.isNew truthy → 'X')

    // Row 2: flags off → the same jacket-condition codepath renders '' (no 'X').
    const row2 = await rowTextsFor(res.buffer, 'SN-002');
    expect(row2).not.toContain('X');
  });
});
