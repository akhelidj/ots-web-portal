# Inspection Report Workflow API

Endpoints for the workflow engine that governs report statuses. The authoritative matrix is `INSPECTION_REPORT_TRANSITIONS` in `api/src/app/workflow/workflow.policy.ts`; the portal mirrors it in `inspection-report-ui-policy.ts` for button visibility.

## Role matrix (inspection reports)

| Role           | Allowed transitions                                                                                                                                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADMIN**      | Any forward step; `ON_HOLD` and `CLOSED` from any active status; return `PENDING_APPROVAL → IN_INSPECTION`; reopen `APPROVED → IN_INSPECTION`; from `CLOSED` back to `APPROVED` or `IN_INSPECTION`.                                                                                                  |
| **SUPERVISOR** | Same matrix as ADMIN (intake, force-close, reopen included). |
| **RECEIVER**   | `DRAFT → RECEIVED → READY_FOR_CLEANING → READY_FOR_INSPECTION`.                                                                                                                                                                                                                                      |
| **INSPECTOR**  | `READY_FOR_INSPECTION → IN_INSPECTION`; `IN_INSPECTION → PENDING_APPROVAL / ON_HOLD`.                                                                                                                                                                                                                |
| **CUSTOMER**   | none (`403`).                                                                                                                                                                                                                                                                                        |

`ON_HOLD` stores the status it came from (`previousActiveStatus` on the transition log). Only SUPERVISOR or ADMIN may **release** a hold, and only back to that previous status (or `CLOSED`). A reason is required for `→ ON_HOLD`, `APPROVED → IN_INSPECTION` (reopen), and any transition out of `CLOSED`.

Child reports have their own matrix (`CHILD_REPORT_TRANSITIONS`): `DRAFT → IN_INSPECTION → PENDING_APPROVAL → APPROVED → CLOSED` (inspector: the first two steps; supervisor: approve and close; admin: all, plus reopen `APPROVED → IN_INSPECTION` with a reason). RECEIVER and CUSTOMER have none.

## 1. Get Available Transitions

`GET /inspection-reports/:id/available-transitions` — transitions the caller may perform from the current status.

```json
{
  "fromStatus": "IN_INSPECTION",
  "transitions": [
    { "toStatus": "PENDING_APPROVAL", "requiresReason": false },
    { "toStatus": "ON_HOLD", "requiresReason": true }
  ]
}
```

`404` if the report is not in the caller's tenant.

## 2. Execute Transition

`POST /inspection-reports/:id/transitions`

```json
{ "toStatus": "ON_HOLD", "reason": "Missing required parts", "version": 4 }
```

- `toStatus` and `version` are required; `reason` is required when the transition needs one.
- Optimistic concurrency: `409` on version mismatch; the write is guarded by `updateMany({ where: { version } })`.
- `403` when the matrix does not allow the transition for the caller's role (including every CUSTOMER call).
- **`PENDING_APPROVAL` gate:** requires ≥ 1 serial, each with a disposition (when the definition's `disposition.requiredForApproval` is set), and all `required` item fields present — else a structured `400` `VALIDATION_FAILED` (see [Dispositions](dispositions.md)). A template with no gate definition yields `412`.
- **Side effects:** a transition log + audit row; a revision snapshot on first approval and on reopen ([revision engine](../architecture/revision-snapshot-engine.md)); on `→ PENDING_APPROVAL` the submitter's current account signature is frozen onto the report; on `→ APPROVED` supervisor-signed fields receive the approver's account signature (refused if a required one has none); a reopen clears field signatures for the new revision.
- Returns `201` with the updated report.

## 3. Get Transition History

`GET /inspection-reports/:id/transitions` — newest first.

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

## 4. Child report transitions

- `POST /child-reports/:id/transition` `{ toStatus, reason? }`
- `GET /child-reports/:id/transitions/available`

Same role/matrix model, using `CHILD_REPORT_TRANSITIONS`.
