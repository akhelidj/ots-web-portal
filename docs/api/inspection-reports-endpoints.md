# Inspection Reports API

All endpoints are tenant-scoped and require authentication (Bearer JWT). Role checks are enforced by `@Roles()` + `RolesGuard` on the controller (`inspection-reports.controller.ts`).

## Roles at a glance

| Endpoint                                                            | Roles                                            |
| ------------------------------------------------------------------- | ------------------------------------------------ |
| `GET /inspection-reports`, `GET /inspection-reports/:id`            | ADMIN, RECEIVER, SUPERVISOR, INSPECTOR, CUSTOMER |
| `GET /inspection-reports/available-templates`                       | ADMIN, RECEIVER                                  |
| `POST /inspection-reports`                                          | ADMIN, RECEIVER                                  |
| `PATCH /inspection-reports/:id`                                     | ADMIN, RECEIVER, INSPECTOR, SUPERVISOR           |
| `POST /inspection-reports/:id/attachments`                          | ADMIN, RECEIVER, INSPECTOR, SUPERVISOR           |
| `POST .../approval-batches`                                         | ADMIN, INSPECTOR                                 |
| `POST .../approval-batches/:batchId/approve` / `return`             | ADMIN, SUPERVISOR                                |
| `GET .../approval-batches`, `.../:batchId`, `.../approval-progress` | ADMIN, RECEIVER, SUPERVISOR, INSPECTOR           |

**Customer scoping:** a `CUSTOMER` only ever sees reports of their own `customerId` (list and detail). Customers see reports in **every** status; there is no status filter. `SUPERVISOR`/`ADMIN` may additionally filter the list by `customerId`.

**Tenant isolation:** every operation is bound to the caller's `tenantId`.

## 1. List — `GET /inspection-reports`

Query (all optional): `status` (an `InspectionReportStatus`), `q` (PO number substring, applied only when ≥ 2 characters), `customerId` (SUPERVISOR/ADMIN only).

Returns an array of reports, newest update first. Each report is returned with its bound template's `definitionJson` grafted on (`null` for a template with no definition) so the portal can render specs offline.

## 2. Available templates — `GET /inspection-reports/available-templates`

The create-form picker's source: the newest version of every template key that is `ACTIVE`, **defined** (`definitionJson != null`) and admin-**APPROVED**. Enforced as a server-side WHERE. Minimal shape only — never the workbook or the definition contents:

```json
[
  {
    "templateKey": "DRILL_PIPE_REPORT",
    "templateVersion": 3,
    "displayName": "Drill Pipe Report"
  }
]
```

## 3. Create — `POST /inspection-reports`

```json
{
  "customerId": "uuid",
  "poNumber": "PO-2026-0001",
  "templateKey": "DRILL_PIPE_REPORT"
}
```

All three fields are required (`templateKey` is **not** ignored). The report is bound to the newest `ACTIVE` + `APPROVED` + defined version of that key, in one transaction, and starts at `DRAFT`, `version: 1`. `reportNumber` is generated server-side as `<CUSTOMER_CODE>-<yymmdd>-<hhmmss>` (the customer's code, or a prefix derived from its name). The binding (`templateKey`, `templateVersion`, `templateHash`) is immutable afterwards.

Errors: `400` (missing `customerId`/`templateKey`, or no active, approved, defined template for the key), `404` (customer not in tenant).

## 4. Detail — `GET /inspection-reports/:id`

Returns the report with its attachments and the bound template's `definitionJson`. `404` if it does not exist, belongs to another tenant, or (for CUSTOMER) another customer.

## 5. Update — `PATCH /inspection-reports/:id`

Optimistic concurrency: the body must carry the last-known `version`. Accepted fields:

- `poNumber`
- `headerData` — the template's header-scope values. Values for **roled** header fields (inspector, supervisor, inspection date) are system-derived and silently dropped.
- `statistics` — free-entry report statistics, see below. Replaces the whole list; `null` or `[]` clears it; omitting it leaves it untouched.
- `status` — in practice status changes go through the workflow endpoint; see [transitions](inspection-report-transitions.md).

Errors: `409` on version mismatch, `400` when the report is `APPROVED` or `CLOSED` ("Cannot mutate an Approved or Closed report. Admin revision required."), `404`.

### Statistics

`InspectionReport.statistics` is a JSON column: `[{ id, label, value, serials[] }]`, typed by the inspector — nothing is computed. Normalised server-side (`report-statistics.ts`): `id` unique non-empty; `label` required (≤ 80 chars); `value` required string (≤ 60 chars; numbers are stringified); `serials` an optional de-duplicated list of serial **texts** (stable across offline temp-id remaps; ≤ 2000); at most 50 statistics. Any malformed row is a `400`. They ride the normal report-update path, so they work offline through the outbox.

## 6. Attachments — `POST /inspection-reports/:id/attachments`

Multipart upload (`file`). Rejected with `400` when the report is `APPROVED`/`CLOSED`. Bytes go through the pluggable attachment storage (local disk or S3, selected by config). Download via `GET /api/files/attachments/:id`.

## 7. Approval batches

Serials are reviewed in batches; see [Dispositions](dispositions.md) and [transitions](inspection-report-transitions.md).

- **Submit** — `POST /inspection-reports/:id/approval-batches` `{ serialNumberIds[], reportVersion, notes?, childReportId? }`. Every serial must be `INSPECTED_DRAFT`. Pass `childReportId` to submit serials of a child report instead of the parent's.
- **Approve** — `POST .../:batchId/approve` `{ batchVersion, reportVersion, serialNumberIds[], reason? }`. When every serial and batch of the report is approved the **report is approved automatically** and the approver's account signature is applied to supervisor-signed fields (the approval is refused if a required one has no signature). The same auto-approval applies to a child report.
- **Return** — `POST .../:batchId/return` `{ batchVersion, reportVersion, serialNumberIds[], reason }`. `reason` is required.
- **Read** — `GET .../approval-batches`, `GET .../approval-batches/:batchId`, `GET .../approval-progress`.

Both batch and report versions are checked (`409` on mismatch).
