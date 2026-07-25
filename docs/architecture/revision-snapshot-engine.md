# Revision Snapshot Engine Architecture

## Overview

The Revision Snapshot Engine ensures that `InspectionReport` and `ChildReport` entities have immutable history tracking. Whenever a report is approved or subsequently mutated by an admin, a revision snapshot is created. This system guarantees that the exact state of a report at the time of approval is preserved for audit and legal purposes.

## Core Concepts

### 1. Revision Numbering

- **`revisionNumber`**: An incrementing integer on the `InspectionReport` and `ChildReport` tables.
- **Default**: 0 (Draft/Pre-approval state).
- **Revision 1**: Created automatically upon the first transition to `APPROVED`.
- **Revision n+1**: Created when an Admin makes a mutation to an already `APPROVED` report (including Reopen/Status changes).

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

- On transition to `APPROVED` (if `revisionNumber` is null): Calls `createInspectionReportSnapshot` (Revision 1).
- On Reopen (`APPROVED` -> `IN_INSPECTION`): Calls `createInspectionReportSnapshot` (Revision n+1).

**ChildReportWorkflowService**:

- On transition to `APPROVED` (if `revisionNumber` is 0): Calls `createChildReportSnapshot`.
- On Reopen: Calls `createChildReportSnapshot`.

## Admin Mutation (Future Integration)

For any future Admin Edit endpoints that modify `APPROVED` reports:

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
