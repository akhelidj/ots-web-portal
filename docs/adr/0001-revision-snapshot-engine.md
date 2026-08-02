# ADR-0001 — Revision-snapshot engine

**Status:** Accepted (standing decision)

## Context

Inspection reports are audited records: once approved, their exact state must be
reproducible and immutable, and a report can be reopened and re-approved, yielding
multiple revisions. Meanwhile the live rows (serials, child reports, logs) keep
mutating.

## Decision

On **first approval** and on **reopen**, `RevisionService` writes an immutable
`InspectionReportRevision` containing a deterministic `snapshotJson` (serials, child
reports, and logs in strict sorted order, with explicit field selection), sets
`revisionNumber = current + 1`, and bumps the parent's `revisionNumber`. Each snapshot
validates the report's template binding. Anchors:
`api/src/app/revision/revision.service.ts:13,:20`; snapshot shape
`api/src/app/common/inspection-data.types.ts:128`.

*Why not the alternatives:* reconstruct-on-demand from live rows can't reproduce
historical state (rows mutate); an audit-log alone doesn't capture the full computed
shape.

## Consequences

Point-in-time state is reproducible for exports and audit; history is append-only.
Costs: the snapshot must be built deterministically or exports diff spuriously (see
ADR-0005); its shape duplicates the live shape and rides on the authored
`Snapshot`/`InspectionData` types because Prisma's `JsonValue` isn't indexable
(KNOWN-ISSUES #9). By design only approval/reopen snapshot — pre-approval edits are not
captured.
