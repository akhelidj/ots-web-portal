# Export API

Generates an immutable `.xlsx` (or `.zip`) representing a frozen revision of an inspection report.

## Endpoint

### `GET /inspection-reports/:id/export`

Authenticated; a `CUSTOMER` may only export their own customer's reports (`403` otherwise). The portal shows the button to CUSTOMER, SUPERVISOR and ADMIN.

**Query:** `revision` (optional integer; defaults to the report's current `revisionNumber`; non-numeric → `400`).

**Governance:**

- The report must be in the caller's tenant.
- Export is allowed only when the **parent** is `APPROVED` or `CLOSED`, **or** its REWORK child report is `APPROVED` or `CLOSED` (a child-only export carries no parent signatures). Otherwise `403`.
- Output is built from the revision's immutable `snapshotJson` (revision 0 — e.g. a batch-auto-approved report with no snapshot, KNOWN-ISSUES #19 — is built live), using the pinned template's workbook (read from storage by `fileKey`) and definition.
- **Signatures:** the inspector signature frozen at submission, the supervisor's account signature applied at approval, and any customer signature for that revision are embedded. For the report's **current** revision, a `required` signature field that is still unsigned blocks the export with `409` `{ code: "SIGNATURE_PENDING", message }`; unsigned optional fields (and older revisions) are left blank.

**Response `200`:** attachment download.

- A single `.xlsx`, or a `.zip` when the output is several files — serials chunked by the definition's region `chunkSize`, or parent + child files together. The zip is named `OTS_<PO>_<reportNumber>_<revision>.zip`.
- `400` when template mapping validation fails (e.g. repeating-row tokens that span multiple worksheet rows).
- `404` for a missing report or revision.
