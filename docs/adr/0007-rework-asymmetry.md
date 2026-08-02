# ADR-0007 — REWORK asymmetry

**Status:** Accepted (standing decision)

## Context

A parent serial marked `REWORK` is the signal to spawn a rework child report. A
child-report serial must never itself be `REWORK` — that would imply rework-of-rework
recursion and an invalid workflow state.

## Decision

The disposition rule is deliberately **asymmetric**. On the **parent** serial path,
`REWORK` is an accepted, sanctioned value — it is exactly the trigger
`ChildReportsService` keys on (it filters parent serials by `body.emiResult === REWORK`
to create/sync the rework child). On the **child-report** serial path, `REWORK` is
rejected with `BadRequestException`, including when smuggled through
`inspectionData.body.emiResult`. Anchors: parent accepts
`serial-numbers.service.ts:268-270`; child rejects `child-reports.service.ts:264-266`
(direct payload) and `:304-308` (post-resolution emiResult re-check).

*Why not the alternatives:* symmetric-reject breaks the parent trigger; symmetric-accept
corrupts the workflow by allowing REWORK children.

## Consequences

The rework workflow functions, and the child guard is defence-in-depth (top-level payload
check + post-resolution emiResult check). Costs: the rule is non-obvious and easy to
"fix" wrongly — adding a REWORK guard to the parent would silently break rework creation,
so it must stay documented. Disposition travels in `body.emiResult`, which interacts with
the disposition-orphan gate (KNOWN-ISSUES #4).
