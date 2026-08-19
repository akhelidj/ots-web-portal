import { InspectionReportStatus } from '@prisma/client';
import {
  Snapshot,
  SnapshotEquipment,
  SnapshotInspectionMethod,
} from './inspection-data.types';

/**
 * The columns `assembleSnapshotHeader` reads off an `InspectionReport` row. A
 * structural subset so both callers (the revision snapshot builder and the
 * export-time live builder) can pass their Prisma row directly.
 */
export interface HeaderSourceRow {
  id: string;
  poNumber: string;
  reportNumber: string | null;
  status: InspectionReportStatus;
  customerId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  // Legacy named header columns — the back-compat overlay BASE (Phase D step 2
  // bridge; deleted in step 3 once rows are backfilled into headerData).
  grade: string | null;
  range: string | null;
  weight: string | null;
  nomWT: string | null;
  nomOD: string | null;
  nomID: string | null;
  connection: string | null;
  inspectionAddress: string | null;
  standardUsed: string | null;
  inspectorComment: string | null;
  equipmentUsed: unknown;
  inspectionMethod: unknown;
  // Generic, definition-keyed header store (Phase D step 2). Overlays the columns.
  headerData?: unknown;
}

/**
 * Assemble a report row into the immutable `snapshot.header`.
 *
 * Phase D step 2 — the header is GENERIC: the export engine reads header-scope
 * fields by dotted key (`walkPath(snapshot.header, entry.field)`), so any key a
 * template declares (including a non-drill-pipe field like `certNumber`) resolves
 * as long as it lands on the header. Assembly is:
 *
 *   { ...metadata, ...namedColumnBridge, ...(headerData ?? {}) }
 *
 * The **named-column bridge** is the one surfaced back-compat read (see
 * schema.prisma `headerData` note): legacy/seeded rows carry their header values in
 * the named columns and no `headerData`, so they keep exporting byte-for-byte as
 * before. A report edited through the generic header form carries `headerData`,
 * which overlays (and thus supersedes) the now-stale columns. Both the columns and
 * this bridge are removed in step 3, after existing rows are backfilled.
 *
 * SINGLE SOURCE OF TRUTH: both `revision.service` (persisted snapshot) and
 * `export.service` (rev-0 live rebuild) call this, so the two can never drift.
 */
export function assembleSnapshotHeader(row: HeaderSourceRow): Snapshot['header'] {
  const generic =
    row.headerData && typeof row.headerData === 'object'
      ? (row.headerData as Record<string, unknown>)
      : {};

  return {
    id: row.id,
    poNumber: row.poNumber,
    reportNumber: row.reportNumber,
    status: row.status,
    customerId: row.customerId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // --- named-column bridge (back-compat base; step 3 deletes) ---
    grade: row.grade,
    range: row.range,
    weight: row.weight,
    nomWT: row.nomWT,
    nomOD: row.nomOD,
    nomID: row.nomID,
    connection: row.connection,
    inspectionAddress: row.inspectionAddress,
    standardUsed: row.standardUsed,
    inspectorComment: row.inspectorComment,
    equipmentUsed: row.equipmentUsed as SnapshotEquipment[] | null,
    inspectionMethod: row.inspectionMethod as SnapshotInspectionMethod[] | null,
    // --- generic overlay: definition-keyed edits win over the columns ---
    ...generic,
  };
}
