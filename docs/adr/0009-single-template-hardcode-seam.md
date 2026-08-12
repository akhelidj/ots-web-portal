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

## Cutover status: the engine carries 3 of the 4 hardcoded locations

The definition-driven engine (`Template.definitionJson`) currently subsumes **three** of
the four places drill-pipe behavior is hardcoded. Each has a definition-fed equivalent
that reads the `definitionJson` column **live** (falling back to the hardcoded path while
the column is NULL):

1. **Approval gate** — `engineGate` reads `fields` / `disposition`
   (`inspection-report-workflow.service.ts:307-329`, vs `legacyGate`).
2. **Export** — `engineMap` reads `export` / `transforms` / `regions`
   (`export.service.ts:282-346`, vs `mapDrillPipeReportV1`).
3. **Portal form** — `definitionToFormSchema` reads `fields` / `sections`
   (delivered via `getReports`, vs the hardcoded `DRILL_PIPE_V1_SCHEMA`).

The **fourth** — the REWORK child-report rule — is a different case. It is *authored* in
the definition's `rules` block (`rework-child-on-emi`: `body.emiResult == 'REWORK'` →
upsert a `REWORK` child), but **no consumer reads that block**. `child-reports.service.ts`
(`syncReworkChildReport`) remains the sole authority via its hardcoded
`body.emiResult === 'REWORK'` check. The `rules` entry is descriptive intent, not a live
input.

*Consequence for Phase C:* the REWORK path is **not retireable by deletion**. Removing the
hardcoded check without a `rules` consumer would silently drop child-report creation.
Phase C must first **build the `rules` consumer** — with its own legacy-equivalence proof
and mutation guards, in the pattern of the gate/export/form proofs — and only then retire
the hardcoded path.
