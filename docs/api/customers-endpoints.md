# Customers API

All endpoints are tenant-scoped and require authentication.

## Security
- **Authentication:** Required (Bearer Token)
- **Authorization:** `ADMIN` role required for all customer mutations and queries.
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
*Note: `reason` is required when `isActive` is false.*

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
