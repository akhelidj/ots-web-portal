# Export Engine

How an approved report becomes an Excel file. The mapping is **definition-driven**: nothing about a particular template (cell addresses, columns, disposition marks) is hardcoded; the bound template's workbook and `definitionJson` (`export`, `transforms`, `regions` — see [Template Definition](template-definition.md)) drive everything. Endpoint contract: [`../api/export.md`](../api/export.md). Determinism decision: [ADR-0005](../adr/0005-export-determinism-structural-only.md).

## Data source

Report content comes from the `snapshotJson` of an `InspectionReportRevision` (see [Revision Snapshot Engine](revision-snapshot-engine.md)), not from live rows — **except revision 0**, which is built live from current rows (a report approved through the batch auto-approval path has no snapshot yet; KNOWN-ISSUES #19). The header block is assembled from report metadata + `headerData` + derived actors (`inspectedBy`/`approvedBy`/`reportDate` come from the transition log). Two things are read live and are the only exceptions: the pinned template (workbook bytes by `fileKey` + `definitionJson`) and signature images (by storage key).

## Pipeline (`export.service.ts` → `export-engine.ts` → `mappings/xlsx-token-engine.ts`)

1. **Authorise & pick scope.** Tenant check; CUSTOMER limited to their own customer. Exportable when the parent is `APPROVED`/`CLOSED` and/or its REWORK child is `APPROVED`/`CLOSED`; if both, both are exported.
2. **Resolve revision.** `?revision=` or the current `revisionNumber`.
3. **Build token maps** from the definition: `engineGlobalTokens` (header/computed/const entries), `engineRowTokens` (per-serial entries), applying named **transforms** (`booleanMap`, `rangeCompose`, `objectListJoin`, `stringListJoin`) and `whenEmpty` fallbacks.
4. **Expand and substitute** in the OOXML directly (`expandRegionAndSubstitute`): tokens are whitespace-canonicalised (`{{ x }}` = `{{x}}`); the repeating row is **inferred** from the region's row tokens, cloned per serial, with later rows and merged cells shifted. Tokens spread across more than one worksheet row are a `400` (authoring fault of the workbook).
5. **Chunk** serials by the region's `chunkSize` (drill pipe: 10); `null` = never split. A **flat** template (no region) always yields exactly one header-only file.
6. **Signatures:** the inspector's frozen signature, the supervisor's applied account signature and any customer signature are swapped into their placeholder cells; a `required` field signature that is missing blocks the export of the current revision (`409 SIGNATURE_PENDING`), otherwise the cell is cleared.
7. **Package.** One file → `.xlsx`; several (chunks, or parent + child) → `.zip`.

## Ordering and naming

- Parent serials: non-`REWORK` first, `REWORK` last, then by serial text — deterministic for a given snapshot.
- Names: `OTS_<PO>_<reportNumber>_<revision>` (PO upper-cased, spaces → `_`, `NOPO` if absent); child files add `_rework_` before the revision; chunked parts are `…_part<k>of<n>.xlsx`; the zip is `<base>.zip`.

## Quirks deliberately preserved

`objectListJoin` renders `"undefined"` for a name-less entry and `stringListJoin` renders `"[object Object]"` for a name-less object — see KNOWN-ISSUES #13/#14. They are pinned by `export-engine.equivalence.spec.ts` and corrected only as a deliberate, separate change.

## Not supported

`HOLD` dispositions are no longer special-cased by the engine; whether a template can display one depends on its workbook/definition.
