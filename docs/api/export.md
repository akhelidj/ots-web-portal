# Export API

This API endpoint generates an immutable output file (Excel or ZIP) representing a snapshot of an Inspection Report.

## Endpoint

### `GET /inspection-reports/:id/export`

Downloads the inspection report's frozen data in `.xlsx` format. If there are more than 10 serial numbers to be exported, it returns a `.zip` file containing multiple chunks as `.xlsx` files.

**Requirements & Governance:**
- The `InspectionReport` must belong to the active tenant.
- The `InspectionReport` must precisely be in `APPROVED` status.
- The `templateHash` must cryptographically match the bound system template.

**Query Parameters (Optional):**
- `revision`: Explicit revision number integer. If omitted, uses the report's current active `revisionNumber`.

**Responses:**
- `200 OK`: A forced download binary Blob stream.
  - Generates `Content-Disposition` header defining the filename (`inspection-report-{reportNumber}.xlsx` or `.zip`).
  - Supports `filename*=` URL-encoded parsing or standard `filename=` parsing for extraction.
- `400 Bad Request`:
  - Returned if template mapping validation fails (e.g., mismatching column data layout constraints).
- `403 Forbidden`: Let through if `TenantId` verification succeeds but the report itself is in the wrong status (e.g. `DRAFT`).
- `404 Not Found`: Missing report, omitted revision, or report outside the tenant scope.
