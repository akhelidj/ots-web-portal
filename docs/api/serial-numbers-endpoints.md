# Serial Numbers API

Manage Serial Numbers (the pipes) attached to Inspection Reports. All operations are bound to the authenticated user's `tenantId`.

## Security

| Endpoint                                         | Roles                                            |
| ------------------------------------------------ | ------------------------------------------------ |
| `GET /inspection-reports/:id/serial-numbers`     | ADMIN, RECEIVER, SUPERVISOR, INSPECTOR, CUSTOMER |
| `POST /inspection-reports/:id/serial-numbers`    | ADMIN, RECEIVER                                  |
| `PATCH /serial-numbers/:id`                      | ADMIN, RECEIVER, INSPECTOR                       |
| `DELETE /serial-numbers/:id`                     | ADMIN, RECEIVER                                  |

A `RECEIVER` may rename a serial but is refused (`403`) if the body carries `inspectionData`. A `CUSTOMER` can only read serials of their own customer's reports. Cross-tenant ids return `404`.

## 1. List — `GET /inspection-reports/:id/serial-numbers`

Returns the report's serials (alphanumeric order) with their `inspectionData`, `disposition`, `approvalStatus` and `version`.

## 2. Bulk create — `POST /inspection-reports/:id/serial-numbers`

```json
{
  "items": [
    { "clientRef": "temp-uuid-1", "serialNumber": "SN-001" },
    { "clientRef": "temp-uuid-2", "serialNumber": "A23" }
  ]
}
```

Values are trimmed; a blank value is `400`; an empty `items` array is `400`. Duplicates (case-insensitive) within the payload, or against serials already on the report, fail the **whole** request with `409` (`{ message, duplicatesInPayload[], alreadyExists[] }`). Rejected with `400` when the report is `APPROVED`/`CLOSED`.

Response `201` echoes `clientRef` so the offline client can remap temporary ids (each serial created at `version: 1`):

```json
{ "items": [{ "clientRef": "temp-uuid-1", "id": "uuid", "serialNumber": "SN-001", "version": 1 }] }
```

## 3. Update — `PATCH /serial-numbers/:id`

```json
{ "serialNumber": "SN-002", "inspectionData": { "...": "..." }, "version": 1 }
```

`version` is required (`400` if absent). Either `serialNumber` (rename) or `inspectionData` (see [Serial Number Inspection](serial-number-inspection.md)) or both.

- `400` — report is `APPROVED`/`CLOSED` ("Inspection data is locked by report status."), serial is `SUBMITTED_FOR_APPROVAL` or `APPROVED`, empty serial, or invalid disposition.
- `409` — version mismatch, or a rename to a value that already exists on the report.
- Providing meaningful inspection data moves an un-submitted serial to `INSPECTED_DRAFT`. The disposition column is re-derived from the data via the template definition ([Dispositions](dispositions.md)).

## 4. Delete — `DELETE /serial-numbers/:id`

Only before the inspection stage: report status `DRAFT`, `RECEIVED` or `READY_FOR_CLEANING`; otherwise `400`.
