# Template API Endpoints

## Base URL

`/templates` — protected. The controller is guarded at the class level for **ADMIN and
SUPERVISOR**; the three endpoints that retire or release a version (`approve`, `reject`,
`deprecate`) re-narrow to **ADMIN** with a method-level `@Roles`, which wins because
`RolesGuard` resolves roles with `getAllAndOverride([handler, class])`.

| Endpoint                                        | ADMIN | SUPERVISOR |
| ----------------------------------------------- | ----- | ---------- |
| `POST /templates` (upload)                      | ✅    | ✅         |
| `GET /templates` (list)                         | ✅    | ✅         |
| `GET /templates/:id/tokens`                     | ✅    | ✅         |
| `GET|PUT /templates/:id/definition`             | ✅    | ✅         |
| `GET /templates/:id/definition/revisions`       | ✅    | ✅         |
| `POST …/revisions/:n/restore`                   | ✅    | ✅         |
| `PATCH /templates/:id/approve`                  | ✅    | ❌         |
| `PATCH /templates/:id/reject`                   | ✅    | ❌         |
| `PATCH /templates/:id/deprecate`                | ✅    | ❌         |

## The admin validation gate

A template version carries `approvalStatus` (`PENDING_APPROVAL` | `APPROVED` |
`REJECTED`), orthogonal to `status` (the ACTIVE/DEPRECATED lifecycle) and to
`definitionJson` (the form shape). It is decided by the **uploader's role, read off the
JWT — never from the request body**:

- **ADMIN upload → `APPROVED`** on creation, self-stamped (`approvedById` = uploader).
- **SUPERVISOR upload → `PENDING_APPROVAL`**, `approvedById`/`approvedAt` null.

Only an `APPROVED` version can be consumed. `GET /inspection-reports/available-templates`
and `POST /inspection-reports` both AND `approvalStatus: APPROVED` into their WHERE
alongside ACTIVE + defined, so a pending or rejected version can never back a report — the
gate is enforced server-side in both the picker and the create path, not in the client.

A supervisor uploads **and** defines freely while pending; approval releases the finished
thing for use.

**Deferred handover:** an upload that lands `PENDING_APPROVAL` does **not** deprecate the
previous ACTIVE version — that would take the live form out of service on the strength of
an unvalidated file. The handover is deferred to `approve`, which performs it when the gate
clears. An ADMIN upload retires the prior version immediately, as before.

See [ADR-0011](../adr/0011-template-upload-supervisor-admin-validation.md).

---

## 1. Upload Template

**POST** `/templates` — ADMIN, SUPERVISOR

Creates a new version of a template. Validates structure, computes hash, increments
version, sets the validation gate from the uploader's role, and (only when the new version
is `APPROVED`) deprecates the previous active version.

### Request

**Content-Type**: `multipart/form-data`

| Field         | Type   | Required | Description               |
| ------------- | ------ | -------- | ------------------------- |
| `file`        | File   | Yes      | `.xlsx` file only.        |
| `templateKey` | String | Yes      | E.g., `DRILL_PIPE_REPORT` |
| `changeNote`  | String | Yes      | Reason for update.        |

### Response (201 Created)

```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "templateKey": "DRILL_PIPE_REPORT",
  "templateVersion": 2,
  "status": "ACTIVE",
  "approvalStatus": "PENDING_APPROVAL",
  "approvedById": null,
  "approvedAt": null,
  "rejectionReason": null,
  "hash": "sha256...",
  "changeNote": "Updated logo",
  "createdAt": "2026-02-19T..."
}
```

### Errors

- `400 Bad Request`: Invalid file type (must be .xlsx), missing sheets, mismatching cell markers, or missing fields.
- `403 Forbidden`: Role other than ADMIN or SUPERVISOR.

---

## 2. List Templates

**GET** `/templates` — ADMIN, SUPERVISOR

Lists all template versions for the current tenant, including the gate columns so the list
can show validation state and a rejection reason. Metadata only — never the workbook.

### Response (200 OK)

```json
[
  {
    "id": "uuid",
    "templateKey": "DRILL_PIPE_REPORT",
    "templateVersion": 2,
    "status": "ACTIVE",
    "approvalStatus": "APPROVED",
    "approvedById": "uuid",
    "approvedAt": "2026-02-19T...",
    "rejectionReason": null,
    ...
  },
  ...
]
```

---

## 3. Approve Template

**PATCH** `/templates/:id/approve` — **ADMIN only**

Clears the validation gate on a pending version: sets `approvalStatus: APPROVED`, stamps
`approvedById`/`approvedAt`, clears any `rejectionReason`, and performs the **deferred
handover** — deprecating the version this one replaces. After this the version is
available for new reports.

### Rules

- **Idempotent** on an already-`APPROVED` version: returns the row unchanged and does
  **not** run the handover a second time.
- A `REJECTED` version cannot be approved (`400`) — rejection is terminal; upload a new
  version instead.

### Response (200 OK)

Returns updated template metadata. Writes an `APPROVE_TEMPLATE_VERSION` audit log (plus a
`DEPRECATE_VERSION` entry for the version it retires).

### Errors

- `400 Bad Request`: the version was rejected.
- `403 Forbidden`: non-admin, or the template belongs to another tenant.
- `404 Not Found`: no such template.

---

## 4. Reject Template

**PATCH** `/templates/:id/reject` — **ADMIN only**

Refuses a pending version with a reason the uploader sees on the templates list.

### Request

```json
{ "reason": "Serial column is mapped to the wrong sheet" }
```

### Rules

- `reason` is **required** (validated in both the controller and the service; blank or
  whitespace-only → `400`).
- Terminal: a rejected version can never become available. The supervisor retries by
  uploading a **new** version — never an in-place edit.
- An already-`APPROVED` version cannot be rejected (`400`) — deprecate it instead.
- Touches no other row: the live ACTIVE version stays in service.

### Response (200 OK)

Returns updated template metadata (`approvalStatus: REJECTED`, `rejectionReason` set).
Writes a `REJECT_TEMPLATE_VERSION` audit log.

### Errors

- `400 Bad Request`: missing/blank reason, or the version is already approved.
- `403 Forbidden`: non-admin, or cross-tenant.
- `404 Not Found`: no such template.

---

## 5. Deprecate Template

**PATCH** `/templates/:id/deprecate` — **ADMIN only**

Manually deprecates a template version. Deliberately still admin-only: deprecating retires
a template ops are actively using, even though uploading and defining no longer are.

### Rules

- Cannot deprecate if it is the _only_ ACTIVE version for that key (must upload new one first).
- Cannot deprecate if already deprecated.

### Response (200 OK)

Returns updated template metadata.
