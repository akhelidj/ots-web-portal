# ADR-0009 — Single-template hardcode with an unwired multi-template seam

**Status:** Accepted (standing decision)

## Context

The product ships one report template today (`DRILL_PIPE_REPORT`). Multi-template is
planned but unbuilt. The domain model already carries `templateKey`.

## Decision

The **live** create path (`InspectionReportsService.createReport`) ignores the
client-sent `templateKey` and **hardcodes** `'DRILL_PIPE_REPORT'`, binding the newest
`ACTIVE` `Template` for the tenant. A second, divergent create implementation
(`InspectionReportWorkflowService.create`) already honors `dto.templateKey` but is
**unwired to any route** and generates no `reportNumber` — it is the deliberate seam for
multi-template expansion. Anchors: `inspection-reports.service.ts:125`;
`inspection-report-workflow.service.ts:32-83`; flow in
`docs/architecture/report-lifecycle.md`.

*Why not the alternatives:* building full multi-template now is YAGNI with one template
shipping to real clients; deleting the `templateKey` plumbing would discard the
ready-made seam.

## Consequences

Single-template behavior is unambiguous, and the expansion path is identified and
preserved. Costs: the client sends a `templateKey` the live path silently ignores — a
real contract mismatch (the template-binding doc reads as if it's honored); and two
create implementations exist, one dead, which is a trap for anyone who wires the wrong
one (`workflow.create` emits no `reportNumber`). This must stay documented as intentional,
not "fixed."
