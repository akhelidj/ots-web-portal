# ADR-0005 — Export determinism is structural-only

**Status:** Accepted (standing decision)

## Context

Exports (xlsx, multi-part zip) must be reproducible and diffable for audit: same input →
same meaningful output. But ExcelJS and the ZIP format embed wall-clock timestamps
(`docProps/core.xml`, per-entry ZIP metadata) that change on every run, and the app
itself renders human-facing dates and identifiers derived from wall-clock time.

## Decision

Determinism is defined over the **structural/content payload** — cell values, sheet
structure, serial ordering (non-REWORK ascending, then REWORK last), filenames, and
mimetype — and deliberately **not** over embedded timestamps or exact bytes. Exports
build from the deterministic snapshot with explicit field selection and sorted
collections. Anchors: `export.service.ts:23,:293`;
`mappings/drill-pipe-report.v1.mapping.ts`; contract pinned by `export.integration.spec.ts`
(asserts structure, excludes timestamps).

*Why not the alternatives:* true byte reproducibility would require zeroing ExcelJS/ZIP
timestamps — brittle and fighting the libraries; dropping the guarantee entirely breaks
audit diffing.

## Consequences

Exports are content-reproducible and diffable on the parts audit cares about. Costs: two
exports of the same report are **not** hash-identical — any consumer expecting byte
equality is mistaken; the REWORK-last ordering is load-bearing and must be preserved;
buffer handling relies on upstream casts (KNOWN-ISSUES #7).

Byte-level non-determinism is **partly an intentional app choice, not only an ExcelJS/ZIP
artifact.** The export deliberately emits wall-clock–derived, human-facing values that
are excluded from the determinism contract:

- **`reportNumber`** is minted as `<PREFIX>-YYMMDD-HHMMSS` (wall-clock) at report
  creation, then carried into the export and filename. It is not regenerated per export
  run, but it is a wall-clock value the export surfaces (`{{reportNumber}}`, filename).
- **`{{reportDate}}`** is rendered `new Date(record.updatedAt ?? record.createdAt).toLocaleDateString()`
  (`mapping.ts:144-147`) — locale/timezone-dependent formatting, so its exact string
  varies by environment even for the same record.
- **`docProps/core.xml` (ExcelJS)** and **per-entry ZIP metadata** are stamped fresh by
  the libraries on every write.

So the structural contract intentionally excludes exactly these values; the test pins
`reportNumber` and omits `{{reportDate}}` to isolate the structure. Byte-non-determinism
is therefore a deliberate decision to show real dates/identifiers, layered on top of the
unavoidable library timestamps.
