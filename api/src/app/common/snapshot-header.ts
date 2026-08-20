import { InspectionReportStatus } from '@prisma/client';
import { Snapshot } from './inspection-data.types';

/**
 * The columns `assembleSnapshotHeader` reads off an `InspectionReport` row. A
 * structural subset so both callers (the revision snapshot builder and the
 * export-time live builder) can pass their Prisma row directly.
 *
 * Phase D step 3 — the named header columns are gone; the header is assembled from
 * metadata plus the generic `headerData` map alone.
 */
export interface HeaderSourceRow {
  id: string;
  poNumber: string;
  reportNumber: string | null;
  status: InspectionReportStatus;
  customerId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  // Generic, definition-keyed header store — the ONLY header-field source.
  headerData?: unknown;
}

/**
 * Assemble a report row into the immutable `snapshot.header`.
 *
 * The header is GENERIC: header-scope field values live in the definition-keyed
 * `headerData` map and are spread onto the header, so any key a template declares
 * (drill-pipe's `grade`/`connection`/… or a non-drill-pipe `certNumber`) resolves
 * through the export engine's `walkPath(snapshot.header, entry.field)` read. Assembly is:
 *
 *   { ...metadata, ...(headerData ?? {}) }
 *
 * Phase D step 3 retired the legacy named columns and their back-compat bridge base:
 * there is no per-column fallback any more — a header field that is not in `headerData`
 * simply resolves empty (→ the entry's `whenEmpty`), never a stale column.
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
    // Generic, definition-keyed header fields — the only header-value source.
    ...generic,
  };
}
