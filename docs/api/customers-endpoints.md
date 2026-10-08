# Customers API

All endpoints are tenant-scoped and require authentication.

## Security

- **Authentication:** Required (Bearer Token)
- **Authorization:** `ADMIN` role required for all customer mutations; `SUPERVISOR` may read the list and logos; `INSPECTOR` and `RECEIVER` may read the list (so reports show customer names). `CUSTOMER` reads only its own branding via `/me/branding`.
- **Tenant Isolation:** All operations are strictly bound to the authenticated user's `tenantId`.

## Endpoints

### 1. List Customers

Retrieves all customers associated with the authenticated user's tenant, sorted alphabetically by name.

**Request:**
`GET /customers`

**Response:**
Returns an array of customer objects.

```json
[
  {
    "id": "cuid...",
    "tenantId": "cuid...",
    "name": "Acme Oilfield Services",
    "code": "AOS",
    "email": "contact@acme.com",
    "phone": "555-0100",
    "isActive": true,
    "version": 3,
    "updatedAt": "2024-01-01T12:00:00Z"
  }
]
```

### 2. Create Customer

Creates a new customer record. The `version` is initialized to 1.

**Request:**
`POST /customers`

```json
{
  "name": "Acme Oilfield Services",
  "code": "AOS",
  "email": "contact@acme.com",
  "phone": "555-0100"
}
```

**Response (201 Created):**
Returns the created customer object.

```json
{
  "id": "cuid...",
  "tenantId": "cuid...",
  "name": "Acme Oilfield Services",
  "code": "AOS",
  "email": "contact@acme.com",
  "phone": "555-0100",
  "isActive": true,
  "version": 1,
  "createdAt": "2024-01-01T12:00:00Z",
  "updatedAt": "2024-01-01T12:00:00Z"
}
```

**Errors:**

- `409 Conflict`: A customer with the exact same name already exists in this tenant.

### 3. Update Customer

Updates an existing customer's details. Enforces optimistic concurrency control.

**Request:**
`PATCH /customers/:id`

```json
{
  "name": "Acme Global",
  "version": 1
}
```

**Response (200 OK):**
Returns the updated customer object with the incremented `version`.

```json
{
  "id": "cuid...",
  "name": "Acme Global",
  "isActive": true,
  "version": 2,
  "updatedAt": "2024-01-02T12:00:00Z"
}
```

**Errors:**

- `409 Conflict`: Version mismatch. The client's provided `version` does not match the server's current version. Client must refresh and retry.
- `404 Not Found`: Customer does not exist or belongs to a different tenant.

### 4. Toggle Active Status

Activates or soft-deactivates a customer. Enforces optimistic concurrency control.

**Request:**
`PATCH /customers/:id/active`

```json
{
  "isActive": false,
  "reason": "Contract expired",
  "version": 2
}
```

_Note: `reason` is required when `isActive` is false._

**Response (200 OK):**
Returns the updated customer object with the incremented `version` and deactivation metadata.

```json
{
  "id": "cuid...",
  "name": "Acme Global",
  "isActive": false,
  "version": 3,
  "deactivatedAt": "2024-01-03T12:00:00Z",
  "deactivatedBy": "user-cuid...",
  "deactivationReason": "Contract expired",
  "updatedAt": "2024-01-03T12:00:00Z"
}
```

**Errors:**

- `400 Bad Request`: Reason omitted when deactivating.
- `409 Conflict`: Version mismatch.
- `404 Not Found`: Customer does not exist or belongs to a different tenant.

### 5. Delete Customer

`DELETE /customers/:id` (ADMIN) — hard-deletes the customer; related rows are set to NULL (`onDelete: SetNull`). An audit row is written. Returns `{ "success": true }`; `404` if not in the tenant. The portal does not expose this: it deactivates instead (see 4).

### 6. Branding (logo + brand colour)

Optional per-customer branding for the customer portal. Online-only (no outbox). Code: `api/src/app/customers/customer-branding.service.ts`, portal palette `portal/src/app/core/theme/brand-palette.ts`.

- **Brand colour:** `brandColor` on `PATCH /customers/:id` (section 3): `"#rrggbb"` to set, `null` to clear. Anything else is a `400`.
- `PUT /customers/:id/logo` (ADMIN), multipart: `file` (PNG, JPEG or WebP, ≤ 1 MB; the type is sniffed from the bytes, so SVG is refused) and `version`. The logo is stored through `AttachmentStorage` under a fresh key (`<tenant>/<customer>/<uuid>`, S3 prefix `S3_BRANDING_PREFIX`, default `branding/`), and the previous object is deleted. Returns the customer with `version + 1`. `409` on a stale version.
- `DELETE /customers/:id/logo?version=N` (ADMIN): clears the logo and deletes the object. Returns the customer with `version + 1`.
- `GET /customers/:id/logo` (ADMIN, SUPERVISOR): the image bytes.
- `GET /me/branding` (CUSTOMER): `{ customerId, name, brandColor, logoId }`, always the caller's own customer (no `:id`). `logoId` changes on every upload and is `null` without a logo.
- `GET /me/branding/logo` (CUSTOMER): the caller's own logo bytes.

The list (section 1) also returns `brandColor`, `logoKey` and `logoMimeType`.
