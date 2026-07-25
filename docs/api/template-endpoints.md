# Template API Endpoints

## Base URL

`/templates` (Protected, Admin only)

## 1. Upload Template

**POST** `/templates`

Creates a new version of a template. Validates structure, computes hash, increments version, and deprecates previous active version.

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
  "hash": "sha256...",
  "changeNote": "Updated logo",
  "createdAt": "2026-02-19T..."
}
```

### Errors

- `400 Bad Request`: Invalid file type (must be .xlsx), missing sheets, mismatching cell markers, or missing fields.
- `403 Forbidden`: Non-admin user.

---

## 2. List Templates

**GET** `/templates`

Lists all template versions for the current tenant.

### Response (200 OK)

Returns array of template objects (metadata only, no file blob).

```json
[
  {
    "id": "uuid",
    "templateKey": "DRILL_PIPE_REPORT",
    "templateVersion": 2,
    "status": "ACTIVE",
    ...
  },
  ...
]
```

---

## 3. Deprecate Template

**PATCH** `/templates/:id/deprecate`

Manually deprecates a template version.

### Rules

- Cannot deprecate if it is the _only_ ACTIVE version for that key (must upload new one first).
- Cannot deprecate if already deprecated.

### Response (200 OK)

Returns updated template metadata.
