/**
 * Shared, DB-free helpers for the flat-template engine proofs
 * (flat-region-baseline.spec.ts + flat-export.spec.ts).
 *
 * Everything here is deterministic and machine-independent so a frozen canon can
 * be committed and re-asserted across runs (ADR-0005: structural, not byte/hash —
 * canon() reads only cell text / structure, never docProps or ZIP timestamps).
 * Volatiles are neutralized at the source: the snapshot header sets a FIXED
 * reportNumber and leaves updatedAt/createdAt undefined so {{reportDate}} derives
 * to the locale-independent literal 'N/A'.
 */
import * as ExcelJS from 'exceljs';
import { InspectionData, Snapshot } from '../common/inspection-data.types';

/** A canonical, timestamp-free view of a workbook: cell text by address + shape. */
export interface SheetCanon {
  name: string;
  maxRow: number;
  cells: Record<string, string>;
  merges: string[];
}

function readCellText(cell: ExcelJS.Cell): string | null {
  const v = cell.value;
  if (v == null) return null;
  if (typeof v === 'object') {
    const anyV = v as unknown as Record<string, unknown>;
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

/** Decode a workbook buffer into its structural canon (excludes all volatiles). */
export async function canon(buffer: Buffer): Promise<SheetCanon[]> {
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
      ((ws as unknown as { model?: { merges?: string[] } }).model?.merges) ?? []
    )
      .slice()
      .sort();
    return { name: ws.name, maxRow, cells, merges };
  });
}

/** The highest row index that carries any non-empty cell, across all sheets. */
export function maxRowOf(sheets: SheetCanon[]): number {
  return sheets.reduce((m, s) => Math.max(m, s.maxRow), 0);
}

/**
 * A fully-deterministic snapshot header. reportNumber is fixed; updatedAt/createdAt
 * are omitted so deriveReportDate → 'N/A' (no locale/timezone dependence).
 */
export function frozenHeader(
  over: Partial<Snapshot['header']> = {},
): Snapshot['header'] {
  return {
    id: 'r-frozen',
    poNumber: 'PO-FROZEN',
    reportNumber: 'RN-FROZEN',
    status: 'APPROVED' as Snapshot['header']['status'],
    customerId: 'c1',
    createdAt: undefined as unknown as string,
    updatedAt: undefined as unknown as string,
    grade: 'G',
    range: 'R',
    weight: 'W',
    nomWT: 'NWT',
    nomOD: 'NOD',
    nomID: 'NID',
    connection: 'CONN',
    inspectionAddress: 'ADDR',
    standardUsed: 'STD',
    inspectorComment: 'CMT',
    equipmentUsed: null,
    inspectionMethod: null,
    customerName: 'Acme',
    ...over,
  };
}

export function frozenSnapshot(
  header: Snapshot['header'] = frozenHeader(),
  extras: Partial<Snapshot> = {},
): Snapshot {
  return {
    header,
    template: { key: 'DRILL_PIPE_REPORT', version: 1, hash: 'h', versionId: null },
    serialNumbers: [],
    childReports: [],
    transitionLogs: [],
    ...extras,
  } as Snapshot;
}

export function makeSerial(
  serial: string,
  inspectionData?: InspectionData,
): Snapshot['serialNumbers'][number] {
  return {
    id: `s-${serial}`,
    serial,
    inspectionData,
    disposition: null,
    updatedAt: undefined as unknown as Date,
  } as Snapshot['serialNumbers'][number];
}
