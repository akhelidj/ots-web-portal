# Serial Number Dispositions (API Contract)

The OTS API supports disposition tracking tightly coupled with offline-first form data, avoiding a loose schema sprawl.

## Storage

Disposition is stored as a standard JSON string mapped inside the Prisma `SerialNumber.inspectionData` field.
The accepted structural mapping is:

```json
{
  "disposition": "PASS" | "REWORK" | "SCRAP" | "HOLD",
  "...otherFields": "..."
}
```

## `PATCH /api/serial-numbers/:id`

The endpoint to update a serial number strictly expects an `inspectionData` sub-object payload alongside the mandatory `version` token.

**Request**

```json
{
  "inspectionData": {
    "disposition": "REWORK",
    "outerDiameter": 5.0,
    "wallThickness": 0.5,
    "threadCondition": "GOOD"
  },
  "version": 4
}
```

**Response** (Returns mapped local representation)

```json
{
  "id": "...",
  "serialNumber": "SN-001",
  "inspectionData": {
    "disposition": "REWORK",
    "outerDiameter": 5.0,
    "wallThickness": 0.5,
    "threadCondition": "GOOD"
  },
  "version": 5,
  "updatedAt": "2024..."
}
```

## Template Dependent Workflow Gating (`PENDING_APPROVAL`)

When an `InspectionReport` attempts to transition to `PENDING_APPROVAL`:

1. The API validates that all associated Serial Numbers have `inspectionData.disposition` defined.
2. If the `templateKey` matches `DRILL_PIPE_REPORT`, the system asserts that `outerDiameter`, `wallThickness`, and `threadCondition` are present inside `inspectionData`.
3. If validation fails, transition is rejected with a `400 Bad Request` holding structured context:

```json
{
  "code": "VALIDATION_FAILED",
  "message": "Validation failed for one or more serial numbers.",
  "missingDispositionSerials": ["SN-001", "SN-003"],
  "missingRequiredFields": {
    "SN-001": ["outerDiameter", "wallThickness"]
  }
}
```

This payload is parsed by the client `SyncDispatcher` to transition the specific sync item state into `ERROR` gracefully for correction, avoiding lost operational intent in an offline-first regime.
