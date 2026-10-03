# Child Reports API

A child report is the follow-up report for serials flagged by the template's **rework rule** (`definition.rules`). The shipped (drill-pipe) rule generates `REWORK` child reports; the rule's `childType` may also be `SCRAP` or `HOLD` (the `ChildReportType` enum), and the export and customer views currently treat the `REWORK` child as the exportable one. Child reports are **not** created through a POST endpoint — they are derived. See [rework rules consumer](../architecture/rework-rules-consumer.md).

## Endpoints

### `POST /inspection-reports/:id/child-reports/sync-rework`

Reconciles the parent's REWORK child report with the serials that currently match the template's rework rule: creates it (`DRAFT`, number = parent number + suffix), adds newly matching serials blank, removes serials that no longer match, preserves data on those that still do, and deletes a still-`DRAFT` child that has no serials left. Tenant-scoped.

### `GET /child-reports?inspectionReportId={id}`

Child reports of a parent (with their serials). `inspectionReportId` is required (`400`). **A CUSTOMER only receives child reports of their own customer's reports.**

### `GET /child-reports/:id`

One child report (customer-scoped the same way; `404` otherwise).

### `PATCH /child-reports/:id`

`{ status?, notes?, version }` — optimistic concurrency (`409` on mismatch).

### `PATCH /child-reports/:id/serial-numbers/:snId`

`{ inspectionData?, disposition? }` — inspection data and disposition for one serial inside the child report. A child serial cannot be given disposition `REWORK`.

### Workflow

`POST /child-reports/:id/transition` and `GET /child-reports/:id/transitions/available` — see [transitions](inspection-report-transitions.md).

### Approval

Child serials are submitted and reviewed through the parent's approval-batch endpoints with `childReportId` (see [Inspection Reports](inspection-reports-endpoints.md#7-approval-batches)). A child report moves to `PENDING_APPROVAL` automatically once all its serials are submitted, and to `APPROVED` once all are approved.
