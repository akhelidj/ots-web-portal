import {
  SerialDisposition,
  InspectionReportStatus,
  ChildReportStatus,
} from '@prisma/client';

/**
 * Shared shape of the `inspectionData` JSON column on `SerialNumber` and
 * `ChildReportSerialNumber`. This is the on-the-wire contract the Angular client
 * produces (see portal `drill-pipe-v1.schema.ts`) — the backend duplicates it
 * here rather than sharing a DTO package (repo convention: no shared DTOs).
 *
 * Every section is independently optional: the column is `Json?`, and every
 * consumer guards each section with `|| {}` / optional chaining. Scalars are
 * `string` (the client emits text inputs); test fixtures that write numeric
 * literals keep their existing casts.
 */
export interface InspectionData {
  /** Body measurements + the authoritative disposition source (`emiResult`). */
  body?: {
    wallRemaining?: string;
    odDecrease?: string;
    slipArea?: string;
    /**
     * The REAL disposition source. Both serial write paths lift this out and
     * persist it to the `SerialDisposition` column; the mapping renders it as
     * `{{emi}}`.
     */
    emiResult?: SerialDisposition;
    corrosionIn?: boolean;
    corrosionOut?: boolean;
    ipc?: boolean;
    bentJoints?: boolean;
  };

  /** Final joint-class flags. */
  final?: {
    isNew?: boolean;
    isPremium?: boolean;
    isC2?: boolean;
    isScrap?: boolean;
    // orphan: read by workflow gate (inspection-report-workflow.service:351),
    // revision snapshot (revision.service:111,204), and export live-build
    // (export.service:141) — never written by the client (absent from
    // drill-pipe-v1.schema.ts and scripts/seed.ts; only test/seed-helpers emit it).
    disposition?: string;
    // orphan: read only by the export mapping (drill-pipe-report.v1.mapping:374),
    // never written by any producer.
    condition_notes?: string;
    // orphan: read only by the export mapping (drill-pipe-report.v1.mapping:374)
    // as a fallback ahead of top-level `remarks`; never written here.
    remarks?: string;
  };

  /** Box-connection measurements — all free-text. */
  box?: {
    minTongSpace?: string;
    minOD?: string;
    minBoxThreads?: string;
    minEccShoulder?: string;
    maxCounterBoreDiameter?: string;
    maxCounterBoreLength?: string;
    bevelDiameterMin?: string;
    bevelDiameterMax?: string;
    condition?: string;
    hardBanding?: string;
  };

  /** Pin-connection measurements — all free-text. */
  pin?: {
    minTongSpace?: string;
    minOD?: string;
    maxID?: string;
    minEccShoulder?: string;
    lengthPinConnMin?: string;
    lengthPinConnMax?: string;
    maxLengthPinBase?: string;
    bevelDiameterMin?: string;
    bevelDiameterMax?: string;
    condition?: string;
  };

  /** Free-text remarks — the authoritative location (client schema key `remarks`). */
  remarks?: string;

  // orphan: legacy fallback, read at workflow gate
  // (inspection-report-workflow.service:351), revision snapshot
  // (revision.service:112,205), and export live-build (export.service:142) —
  // never written by any producer.
  disposition?: string;
}

/**
 * Header equipment entry. `equipmentUsed` is a distinct `Json?` column on
 * `InspectionReport` (not part of `inspectionData`) but surfaces inside the
 * snapshot header; the mapping reads `e.name` and `e.number`.
 */
export interface SnapshotEquipment {
  name?: string;
  number?: string | number;
}

/**
 * Header inspection-method entry. The mapping reads `m.name || m`, so an entry
 * is either an object with a `name` or a bare string.
 */
export type SnapshotInspectionMethod = { name?: string } | string;

/** Transition-log row embedded verbatim in the parent snapshot. */
export interface SnapshotTransitionLog {
  id?: string;
  fromStatus?: InspectionReportStatus;
  toStatus?: InspectionReportStatus;
  previousActiveStatus?: InspectionReportStatus | null;
  timestamp?: Date | string;
  inspectionReportId?: string;
  userId?: string | null;
}

/**
 * Immutable revision snapshot for an `InspectionReport`. Built identically in
 * revision.service:76-118 (persisted to `snapshotJson`) and rebuilt on-the-fly
 * for revision 0 in export.service:107-148. The `serialNumbers[].inspectionData`
 * leaf is embedded verbatim from the live column, so it reuses `InspectionData`.
 * The optional `inspectedByName`/`approvedByName`/`customerName`/`users` are
 * injected at read time by the export path, not persisted.
 */
export interface Snapshot {
  header: {
    /**
     * Phase D step 2 — generic header index. Header-scope field values now live in a
     * definition-keyed `headerData` map assembled into the header (see
     * `assembleSnapshotHeader`), so the header carries arbitrary field keys a
     * non-drill-pipe template may declare (e.g. `certNumber`). The export engine
     * reads them generically via `walkPath(snapshot.header, entry.field)`. The named
     * columns below remain as the back-compat overlay base (deleted in step 3).
     */
    [key: string]: unknown;
    id: string;
    poNumber: string;
    reportNumber: string | null;
    status: InspectionReportStatus;
    customerId: string | null;
    createdAt: Date | string;
    updatedAt: Date | string;
    // Pipe specifications
    grade: string | null;
    range: string | null;
    weight: string | null;
    nomWT: string | null;
    nomOD: string | null;
    nomID: string | null;
    connection: string | null;
    // Job info
    inspectionAddress: string | null;
    standardUsed: string | null;
    inspectorComment: string | null;
    equipmentUsed: SnapshotEquipment[] | null;
    inspectionMethod: SnapshotInspectionMethod[] | null;
    // Injected at read time by export.service (not persisted in snapshotJson)
    inspectedByName?: string;
    approvedByName?: string;
    customerName?: string;
  };
  template: {
    key: string;
    version: number;
    hash: string;
    versionId: string | null;
  };
  serialNumbers: {
    id: string;
    serial: string;
    inspectionData?: InspectionData;
    disposition: string | null;
    updatedAt: Date | string;
  }[];
  childReports: {
    id: string;
    reportNumber: string | null;
    status: ChildReportStatus;
  }[];
  transitionLogs: SnapshotTransitionLog[];
  // Injected at read time by export.service (not persisted in snapshotJson)
  users?: { id: string; name: string | null; email: string }[];
}

/**
 * Immutable revision snapshot for a `ChildReport` (revision.service:189-211).
 * Deliberately thinner than `Snapshot`: it carries NO `inspectionData` — its
 * serial rows are link-table references plus the computed disposition only.
 */
export interface ChildSnapshot {
  header: {
    id: string;
    reportNumber: string | null;
    status: ChildReportStatus;
    createdAt: Date | string;
    updatedAt: Date | string;
    parentReportId: string;
    parentReportNumber?: string | null;
  };
  serialNumbers: {
    linkId: string;
    serialId: string;
    serial: string;
    disposition: string | null;
  }[];
  attachments: {
    id: string;
    filename: string;
    url: string;
    createdAt: Date | string;
  }[];
}
