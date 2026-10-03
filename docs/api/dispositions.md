# Serial Number Dispositions (API Contract)

A serial's disposition is one of `PASS`, `REWORK`, `SCRAP`, `HOLD` (the `SerialDisposition` enum). It is **not** a fixed field of `inspectionData`: each template's definition declares where it lives.

## Where disposition comes from

`Template.definitionJson.disposition.source` is an ordered list of dotted paths into `inspectionData` (first truthy wins). The drill-pipe definition uses `["body.emiResult"]`. Every server surface reads it through the single resolver `resolveDisposition(data, definition)` (`api/src/app/workflow/approval-gate.ts`):

- `PATCH /serial-numbers/:id` — syncs the denormalised `SerialNumber.disposition` column from `inspectionData`; a value outside the enum is `400`.
- the `PENDING_APPROVAL` gate, revision snapshots, the export sort, and the child-report column sync.

A template that declares no `source` resolves to "unknown", which the gate treats as not required unless `requiredForApproval` says otherwise. `REWORK` is a valid value on a parent serial (it is what the rework rule keys on); it is **rejected** on a child-report serial.

## `PENDING_APPROVAL` gate

A transition `→ PENDING_APPROVAL` ([transitions](inspection-report-transitions.md)) requires:

1. at least one serial;
2. when `disposition.requiredForApproval` is true, every serial has a resolved disposition;
3. every item-scope field marked `required` in the definition is present on every serial (missing = `undefined`, `null` or empty string).

Failure is a `400` with a structured body:

```json
{
  "code": "VALIDATION_FAILED",
  "message": "Validation failed for one or more serial numbers.",
  "missingDispositionSerials": ["SN-001", "SN-003"],
  "missingRequiredFields": { "SN-001": ["od_1", "wall_thickness"] }
}
```

The portal's sync dispatcher parses this to put the specific sync item into `ERROR` for correction. See [KNOWN-ISSUES #5](../KNOWN-ISSUES.md) — the global exception filter currently flattens structured bodies in production. A template with no gate definition yields `412`.

## Approval state per serial

`approvalStatus`: `NOT_INSPECTED` → `INSPECTED_DRAFT` → `SUBMITTED_FOR_APPROVAL` → `APPROVED`; a returned serial goes back to an editable state with the reviewer's note. Submitted and approved serials are locked against edits. See [Inspection Reports → approval batches](inspection-reports-endpoints.md#7-approval-batches).
