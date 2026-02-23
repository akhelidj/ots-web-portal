# Inspection Report Workflow API

Endpoints for interacting with the core Workflow Engine governing report statuses and lifecycles.

## 1. Get Available Transitions
Retrieve dynamically calculated acceptable status transitions based strictly on the current report status and requesting user's `UserRole`.

**Endpoint:**
`GET /inspection-reports/:id/available-transitions`

**Authentication / Roles:**
Requires `JwtAuthGuard`. Open to valid users but constrained by the role-based matrix `INSPECTION_REPORT_TRANSITIONS` and scoped by `tenantId`.

**Responses:**

*   `200 OK`
    ```json
    {
      "fromStatus": "IN_INSPECTION",
      "transitions": [
        {
          "toStatus": "PENDING_APPROVAL",
          "requiresReason": false
        },
        {
          "toStatus": "ON_HOLD",
          "requiresReason": true
        }
      ]
    }
    ```

*   `404 Not Found`
    If the report ID does not exist or does not belong to the user's `tenantId`.

---

## 2. Execute Transition
Commit an atomic transition for the given Inspection Report. Emits Audit Trails and strictly checks transition logic, missing preconditions (like SN minimum checks), and data race version matching.

**Endpoint:**
`POST /inspection-reports/:id/transitions`

**Body:**
```json
{
  "toStatus": "ON_HOLD",
  "reason": "Missing required parts",
  "version": 4
}
```

*   `toStatus` (string, required): The target status.
*   `version` (number, required): The current known version of the report, used for Optimistic Concurrency Control natively.
*   `reason` (string, optional): Justification text, required strictly if `requiresReason: true` for that matrix transition.

**Responses:**

*   `201 Created`
    Returns the newly updated entire `InspectionReport` object with its incremented `version` and new `status`.
    
*   `400 Bad Request`
    General validation error:
    - Target status is not permitted from current status or user role.
    - Required reason is missing.
    - Failed internal precondition checks (e.g., minimum Serial Numbers missing).

*   `409 Conflict`
    Data collision. The provided `version` did not match the latest database `version`.

---

## 3. Get Transition History
Retrieve the chronological event history of transitions enacted upon a particular report securely.

**Endpoint:**
`GET /inspection-reports/:id/transitions`

**Authentication / Roles:**
Requires `JwtAuthGuard`. Accessible safely, confirming the parent report `tenantId` natively matches the caller's tenant context.

**Responses:**

*   `200 OK`
    Sorted chronologically descending (newest first).
    ```json
    [
      {
        "id": "abc-123",
        "inspectionReportId": "report-xyz",
        "fromStatus": "READY_FOR_INSPECTION",
        "toStatus": "IN_INSPECTION",
        "userId": "user-uuid",
        "timestamp": "2026-02-23T14:00:00.000Z",
        "reason": null,
        "previousActiveStatus": null
      }
    ]
    ```

*   `404 Not Found`
    If the report ID doesn't exist or is not natively visible to the user's `tenantId`.
