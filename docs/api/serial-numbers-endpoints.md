# Serial Numbers API

Manage Serial Numbers associated with Inspection Reports. All operations are strictly bound to the authenticated user's `tenantId`.

## Security

-   **Authentication:** Required (Bearer Token)
-   **Authorization:**
    -   Creation and Modification: `ADMIN`, `RECEIVER`
    -   Reading: `ADMIN`, `RECEIVER`, `SUPERVISOR`, `INSPECTOR`
-   **Tenant Isolation:** All operations enforce `tenantId` boundaries. Attempting to interact with an `inspectionReportId` or `serialNumber` outside of the active tenant results in `404 Not Found`.

## Endpoints

### 1. List Serial Numbers

Returns all serial numbers attached to an Inspection Report, ordered alphanumerically ascending.

**Request:**
`GET /inspection-reports/:id/serial-numbers`

**Response (200 OK):**

```json
[
  {
    "id": "cuid-sn-1",
    "tenantId": "cuid-tenant",
    "inspectionReportId": "cuid-ir-1",
    "serial": "SN-001",
    "version": 1,
    "createdAt": "2026-02-23T12:00:00.000Z",
    "updatedAt": "2026-02-23T12:00:00.000Z"
  }
]
```

**Errors:**
-   `404 Not Found`: Inspection report not found or belongs to a different tenant.

---

### 2. Bulk Create Serial Numbers

Adds multiple serial numbers to an Inspection Report natively supporting bulk arrays. Trims input values and ignores blank inputs. Will fail completely returning `409 Conflict` if *any* duplicates exist within the payload or currently in the report database.

**Request:**
`POST /inspection-reports/:id/serial-numbers`

```json
{
  "items": [
    { "clientRef": "temp-uuid-1", "serialNumber": "SN-001" },
    { "clientRef": "temp-uuid-2", "serialNumber": "A23" }
  ]
}
```

**Response (201 Created):**
Echos back the `clientRef` mappings for deterministic synchronization.

```json
{
  "items": [
    {
       "clientRef": "temp-uuid-1",
       "id": "cuid-sn-1",
       "serialNumber": "SN-001",
       "version": 1
    },
    ...
  ]
}
```

**Errors:**
-   `404 Not Found`: Inspection report not found or belongs to a different tenant.
-   `400 Bad Request`: Payload missing, wrongly formatted, or contains blank serials.
-   `409 Conflict`: Uniqueness violation. Returns descriptive array.

```json
{
  "message": "Payload contains duplicate serial numbers",
  "duplicatesInPayload": ["SN-22"],
  "alreadyExists": ["SN-10"] // Array of values conflicting against the DB
}
```

---

### 3. Rename/Update Serial Number

Renames a specific Serial Number, enforcing optimistic concurrency locking using `version`.

**Request:**
`PATCH /serial-numbers/:id`

```json
{
  "serialNumber": "SN-002",
  "version": 1
}
```

**Response (200 OK):**
Returns the modified entity with an incremented version.

```json
{
  "id": "cuid-sn-2",
  "serialNumber": "SN-002",
  "version": 2,
  "updatedAt": "2026-02-23T12:04:00.000Z"
}
```

**Errors:**
-   `404 Not Found`: Serial number not found in tenant.
-   `409 Conflict`: Optimistic Concurrency mismatch (expected `version` did not align). Or attempts to rename to a duplicate within the same Inspection report.
