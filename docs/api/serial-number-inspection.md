# Serial Number Inspection

Inspection data for one serial is written with `PATCH /serial-numbers/:id` (roles ADMIN, INSPECTOR; RECEIVER is refused). Its **shape is defined by the report's template** (`Template.definitionJson`, item-scope fields), not by a backend schema. The portal builds the form from that definition (`definition-to-form-schema.ts`); `DRILL_PIPE_V1_SCHEMA` survives only as a fallback when a template has no definition.

## Offline-first

The portal writes locally first and dispatches `SN_UPDATE_INSPECTION` outbox items; the backend validates and locks, returning `400` for structural/state errors and `409` for conflicts. See [report lifecycle](../architecture/report-lifecycle.md).

## Request

```json
{
  "inspectionData": {
    "body": { "emiResult": "PASS", "od_1": 5.5 },
    "remarks": "Minor scuff"
  },
  "version": 2
}
```

`inspectionData` is a free JSON object (the template's keys, possibly nested). The disposition column is re-derived from it per [Dispositions](dispositions.md).

## Constraints and locks

- Parent report `APPROVED`/`CLOSED` → `400` ("Inspection data is locked by report status.").
- Serial `SUBMITTED_FOR_APPROVAL` or `APPROVED` → `400` ("Cannot edit serial numbers that are …").
- `version` must match (`409` otherwise; guarded `updateMany`).
- An `UPDATE` audit log is written.

## Child-report serials

Serials of a rework child report are edited with `PATCH /child-reports/:id/serial-numbers/:snId` ([Child Reports](child-reports.md)); the same locks apply and `REWORK` is not an accepted disposition there.

## Reading

Inspection data is returned by `GET /inspection-reports/:id/serial-numbers`.
