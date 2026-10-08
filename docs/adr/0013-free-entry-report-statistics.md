# ADR-0013 — Report statistics are free-entry, not computed

**Status:** Accepted (standing decision)

## Context

Reports used to show outcome statistics (KPI strip, list pass rate, per-outcome counts) **computed** from a template-authored _outcome mapping_ that classified serial dispositions. Inspectors need to state figures that do not follow mechanically from dispositions (accepted/rejected counts after re-inspection, partial lots, custom categories), and the mapping added authoring and classifier machinery to every template.

## Decision

Statistics are **typed by the inspector** per report: a list of `{ id, label, value, serials[] }` stored in `InspectionReport.statistics` (JSON). A statistic may reference serials by **serial text** (stable across offline temp-id remaps); one that lists serials opens the serials modal.

- Validated and normalised server-side (`report-statistics.ts`): ≤ 50 statistics, label ≤ 80, value ≤ 60 chars, serials de-duplicated; any malformed row is a `400`. The client sends the **whole list** (replace, not merge); `null`/`[]` clears.
- They ride the existing report-update path (`PATCH /inspection-reports/:id` with the report `version`), so they work **offline through the outbox** without touching the sync core. Edits are blocked once the report is Approved/Closed.
- The outcome mapping was **removed everywhere** (wizard, validator, builder, types, drill-pipe definition, shared classifier, KPI strip, list pass rate). The serial tables badge only serials flagged by the template's rework trigger rule.

## Consequences

Inspectors control exactly what the customer sees as findings; templates are simpler. Costs: nothing checks that statistics agree with dispositions, and there is no automatic pass rate. See [`../api/inspection-reports-endpoints.md`](../api/inspection-reports-endpoints.md#statistics).
