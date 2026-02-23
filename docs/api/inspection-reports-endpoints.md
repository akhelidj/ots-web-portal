# Inspection Reports API

All endpoints are tenant-scoped and require authentication.

## Security
- **Authentication:** Required (Bearer Token)
- **Authorization:** `ADMIN` or `RECEIVER` role required for creation and editing. `INSPECTOR` and `SUPERVISOR` can list and view.
- **Tenant Isolation:** All operations are strictly bound to the authenticated user's `tenantId`.

## Endpoints

### 1. List Inspection Reports
Retrieves all inspection reports associated with the authenticated user's tenant, sorted by last updated descending.

**Request:**
`GET /inspection-reports`

**Response:**
Returns an array of inspection report objects.
```json
[
  {
    "id": "cuid...",
    "tenantId": "cuid...",
    "customerId": "cuid...",
    "poNumber": "PO-123",
    "status": "DRAFT",
    "templateKey": "DRILL_PIPE_REPORT",
    "templateVersion": 1,
    "templateHash": "a1b2c3d4e5f6...",
    "version": 1,
    "createdAt": "2024-01-01T12:00:00Z",
    "updatedAt": "2024-01-02T12:00:00Z"
  }
]
```

### 2. Create Inspection Report
Creates a new inspection report. The report is bound to the currently active version of the `DRILL_PIPE_REPORT` template on the server. The `version` is initialized to 1 and status to `DRAFT`.

**Request:**
`POST /inspection-reports`
```json
{
  "customerId": "cuid-customer-id",
  "poNumber": "PO-2026-0001"
}
```
*Note: The template binding fields (`templateKey`, `templateVersion`, `templateHash`, and `status`) are resolved exclusively on the server and ignored if passed by the client.*

**Response (201 Created):**
Returns the full created entity containing all template bound fields.
```json
{
  "id": "cuid...",
  "tenantId": "cuid...",
  "customerId": "cuid-customer-id",
  "poNumber": "PO-2026-0001",
  "status": "DRAFT",
  "templateKey": "DRILL_PIPE_REPORT",
  "templateVersion": 2,
  "templateHash": "f8e7d6c5...",
  "version": 1,
  "createdAt": "2026-01-01T12:00:00Z",
  "updatedAt": "2026-01-01T12:00:00Z"
}
```

**Errors:**
- `404 Not Found`: The specified `customerId` does not exist or does not belong to the user's tenant.
- `400 Bad Request`: No active template found for `DRILL_PIPE_REPORT`.

### 3. Update Inspection Report
Updates safe header fields of an existing report (e.g., `poNumber`). Enforces optimistic concurrency control.

**Request:**
`PATCH /inspection-reports/:id`
```json
{
  "poNumber": "PO-2026-0002",
  "version": 1
}
```

**Response (200 OK):**
Returns the updated report object with the incremented `version`.
```json
{
  "id": "cuid...",
  "poNumber": "PO-2026-0002",
  "status": "DRAFT",
  "version": 2,
  "updatedAt": "2026-01-02T12:00:00Z"
}
```

**Errors:**
- `409 Conflict`: Version mismatch. The client's provided `version` does not match the server's current version. The client must pull latest metadata before retrying.
- `404 Not Found`: Report does not exist or belongs to a different tenant.
