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

## Cutover status: the engine carries 4 of 4 hardcoded locations (complete)

> **Update (a031969 — Phase C complete):** all four hardcoded drill-pipe sites are now
> retired; the text below describing them as live-with-a-legacy-fallback is historical.
> The `definitionJson` engine is the sole live path for the gate, export, form, and REWORK
> behaviors. `legacyGate` and `mapDrillPipeReportV1` no longer exist in the codebase;
> `DRILL_PIPE_V1_SCHEMA` survives only as the portal's soft-NULL form/validation fallback,
> and the imperative REWORK body survives only as a frozen equivalence oracle in test scope
> (`api/test/rework-imperative-oracle.ts`). The templateKey hardcode in the **Decision**
> above is a separate, still-standing constraint and is unaffected.

The definition-driven engine (`Template.definitionJson`) subsumed **all four** places
drill-pipe behavior was hardcoded. Each gained a definition-fed equivalent that reads the
`definitionJson` column live; the legacy paths have since been retired (they fell back to
the hardcoded path only while the column was NULL, which no longer occurs for backfilled
ACTIVE templates):

1. **Approval gate** — `engineGate` reads `fields` / `disposition`
   (`inspection-report-workflow.service.ts:307-329`); the legacy `legacyGate` was retired.
2. **Export** — `engineMap` reads `export` / `transforms` / `regions`
   (`export.service.ts:282-346`); the legacy `mapDrillPipeReportV1` was retired.
3. **Portal form** — `definitionToFormSchema` reads `fields` / `sections`
   (delivered via `getReports`); the hardcoded `DRILL_PIPE_V1_SCHEMA` remains only as the
   soft-NULL fallback.

The **fourth** — the REWORK child-report rule — was a different case. It is *authored* in
the definition's `rules` block (`rework-child-on-emi`: `body.emiResult == 'REWORK'` →
upsert a `REWORK` child). Originally **no consumer read that block** and
`child-reports.service.ts` (`syncReworkChildReport`) was the sole authority via its
hardcoded `body.emiResult === 'REWORK'` check, so the path was **not retireable by
deletion** — removing the check without a consumer would have silently dropped child-report
creation. Phase C therefore first **built the `rules` consumer** (`ReworkRulesInterpreter`,
0a34b12) — with its own legacy-equivalence proof and mutation guards, in the pattern of the
gate/export/form proofs — and only then retired the imperative body (a031969), freezing it
as an independent equivalence oracle in test scope.
