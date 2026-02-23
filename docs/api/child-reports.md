# Child Reports API

The Child Reports API handles the creation and management of secondary inspection flows triggered when a Serial Number fails its initial pass (e.g., REWORK, SCRAP, HOLD).

## Endpoints

### `POST /api/child-reports`

Creates a new Child Report.

**Idempotency & Concurrency:**
The POST endpoint requires the client to supply an `id` (UUID). The server uses deterministic idempotency `findUnique({ where: { id, tenantId } })` resolving to `200 OK` (returning the existing record) if the `id` already exists. It creates the record if it does not.
The server returns the created/existing entity with an initialized `version=1` so the client can begin tracking optimistic concurrency.

**Requirements & Governance:**
- The parent `InspectionReport` must belong to the active tenant.
- The `SerialNumber` must belong to the active tenant and be linked to the parent `InspectionReport`.
- The parent `InspectionReport` must **not** be in `APPROVED` or `CLOSED` status.
- The `SerialNumber`'s `inspectionData.disposition` must strictly match the invoked `type`. For example, a `REWORK` Child Report can only be created if the serial's disposition is `REWORK`. Cannot be `PASS`.

**Request Body:**
```json
{
  "id": "uuid-generated-by-client",
  "inspectionReportId": "uuid-of-parent",
  "serialNumberId": "uuid-of-serial",
  "type": "REWORK", // REWORK, SCRAP, or HOLD
  "notes": "Optional notes string"
}
```

---

### `PATCH /api/child-reports/:id`

Updates an existing Child Report.

**Idempotency & Concurrency:**
Implements atomic optimistic concurrency. The `version` integer must be provided in the payload. The update queries with `{ id, tenantId, version }` and atomically increments the version. If the `version` fails to match, a `409 Conflict` is returned.

**Requirements & Governance:**
- The given `ChildReport` must belong to the active tenant.
- The parent `InspectionReport` must **not** be in `APPROVED` or `CLOSED` status.

**Request Body:**
```json
{
  "status": "COMPLETED", // OPEN or COMPLETED
  "notes": "Updated notes",
  "version": 1 // Required integer for concurrency lock
}
```

---

### `GET /api/child-reports?inspectionReportId={id}`

Fetches all Child Reports for a specific parent `InspectionReport`. Fully tenant-scoped. Returns an array of Child Report objects.
