# Revision Snapshot Engine Architecture

## Overview

The Revision Snapshot Engine ensures that `InspectionReport` and `ChildReport` entities have immutable history tracking. Whenever a report is approved or subsequently mutated by an admin, a revision snapshot is created. This system guarantees that the exact state of a report at the time of approval is preserved for audit and legal purposes.

## Core Concepts

### 1. Revision Numbering

- **`revisionNumber`**: An incrementing integer on the `InspectionReport` and `ChildReport` tables.
- **Default**: 0 (Draft/Pre-approval state).
- **Revision 1**: Created by the **direct** transition to `APPROVED` while `revisionNumber` is 0. ⚠️ A report that becomes `APPROVED` through the **approval-batch auto-approval** path writes no revision (see KNOWN-ISSUES #19); its export is built live as "revision 0".
- **Revision n+1**: Created on **reopen** — `APPROVED → IN_INSPECTION`, or `CLOSED → APPROVED / IN_INSPECTION` (Admin only, reason required).
- Reopening also starts a new **signature revision**: per-report field signatures are tied to the revision and are cleared, while earlier revisions keep theirs.

### What a snapshot contains

`header` (assembled from report metadata + `headerData` via the shared `assembleSnapshotHeader`), the bound `template` (key/version/hash), `serialNumbers` (sorted; each with `inspectionData` and the disposition resolved through the template definition), minimal `childReports`, the `transitionLogs`, and `signatures` — the frozen inspector-signature pointers in force at that moment (omitted when none). Free-entry **statistics are not part of the snapshot** (they are read live by the portal; see ADR-0013). Template-defined field signatures are not embedded either: they live in their own table per revision.

### 2. Immutability

- Snapshots are stored in `InspectionReportRevision` and `ChildReportRevision` tables.
- The `snapshotJson` field contains a deterministic JSON representation of the report at that point in time.
- Once written, a revision row is **never** updated or deleted.

### 3. Data Determinism

To ensure consistent hashes and reproducible snapshots, data is fetched with strict ordering:

- **Serial Numbers**: Ordered by `serial` (ASC).
- **Child Reports**: Ordered by `reportNumber` (ASC).
- **Attachments**: Ordered by `createdAt` (ASC).

## Data Models

### InspectionReportRevision

| Field                | Type     | Description                                  |
| -------------------- | -------- | -------------------------------------------- |
| `id`                 | UUID     | Unique Identifier                            |
| `inspectionReportId` | UUID     | Foreign Key to Parent Report                 |
| `revisionNumber`     | Int      | 1, 2, 3...                                   |
| `snapshotJson`       | JSON     | Full data dump                               |
| `revisionReason`     | String   | e.g., "Initial approval", "Admin correction" |
| `revisedAt`          | DateTime | Timestamp of creation                        |
| `revisedById`        | UUID     | User who triggered the revision              |

### ChildReportRevision

| Field            | Type     | Description                 |
| ---------------- | -------- | --------------------------- |
| `id`             | UUID     | Unique Identifier           |
| `childReportId`  | UUID     | Foreign Key to Child Report |
| `revisionNumber` | Int      | 1, 2, 3...                  |
| `snapshotJson`   | JSON     | Full data dump              |
| `revisionReason` | String   | e.g., "Initial approval"    |
| `revisedAt`      | DateTime | Timestamp                   |
| `revisedById`    | UUID     | User ID                     |

## Revision Service (`RevisionService`)

The `RevisionService` is the **single source of truth** for:

1. Fetching the specific data shape for snapshots.
2. Calculating the next revision number.
3. Creating the revision row.
4. Updating the parent report's `revisionNumber`.
5. Executing all the above within a Prisma Transaction (`tx`) to ensure atomicity.

### Usage in Workflows

**InspectionReportWorkflowService**:

- On the direct transition to `APPROVED` when `revisionNumber === 0`: calls `createInspectionReportSnapshot` (Revision 1).
- On Reopen (`APPROVED → IN_INSPECTION`, `CLOSED → APPROVED / IN_INSPECTION`): calls `createInspectionReportSnapshot` (Revision n+1).
- The approval-batch auto-approval in `InspectionReportsService.approveBatch` does **not** call the revision service (KNOWN-ISSUES #19).

**ChildReportWorkflowService**:

- On transition to `APPROVED` (if `revisionNumber` is 0): Calls `createChildReportSnapshot`.
- On Reopen: Calls `createChildReportSnapshot`.

## Admin Mutation (not yet wired)

`RevisionService.createMutationRevision` exists but **no endpoint calls it today**: an `APPROVED`/`CLOSED` report is simply immutable (`PATCH` → `400`), and the only way to change it is an Admin reopen. For any future Admin Edit endpoint that modifies `APPROVED` reports:

1. The endpoint MUST accept a `reason` for the change.
2. The logic MUST wrap the mutation and the revision creation in a transaction.
3. Call `RevisionService.createMutationRevision(tx, entityType, entityId, reason, user)` **AFTER** applying updates but **BEFORE** committing.

```typescript
// Example Implementation Pattern for Future Admin Endpoints
await prisma.$transaction(async (tx) => {
    // 1. Apply Updates
    await tx.inspectionReport.update({ ... });

    // 2. Create Revision
    await revisionService.createInspectionReportSnapshot(tx, reportId, reason, userId, tenantId);
});
```
