# Serial Number Inspection

This document describes the API interactions for managing and updating inspection data for individual Serial Numbers. Note that inspection data structure is dictated by static templates configured in the frontend (e.g., Drill Pipe v1), rather than dynamic backend schemas.

## Offline-First Philosophy

All state changes relating to inspection data must be optimistically stored by the frontend and dispatched via `SN_UPDATE_INSPECTION` outbox events. The backend guarantees data validation and locking, returning 400 for structural or state errors, and 409 for conflicts.

## Editing Serial Number Inspection Data

`PATCH /api/serial-numbers/:id`

**Request Body**

```json
{
  "inspectionJson": {
    "outerDiameter": 5.5,
    "wallThickness": 0.5,
    "threadCondition": "GOOD",
    "remarks": "Minor scuff"
  },
  "version": 2
}
```

**Constraints & Locks:**

- If the parent Inspection Report is in `APPROVED` or `CLOSED` status, the mutation is rejected with `400 Bad Request` ("Inspection data is locked.").
- An atomic optimistic concurrency check ensures the provided `version` matches the database `version`. If it doesn't, a `409 Conflict` is returned.
- Emits an `UPDATE` audit log when inspection data is modified.

## Retrieving Inspection Data

Inspection data is retrieved as part of the Serial Numbers collection fetch for a given report.

`GET /api/inspection-reports/:id/serial-numbers`

**Response Example**

```json
[
  {
    "id": "123",
    "serialNumber": "SN-001",
    "version": 2,
    "inspectionJson": {
      "outerDiameter": 5.5,
      ...
    }
  }
]
```
