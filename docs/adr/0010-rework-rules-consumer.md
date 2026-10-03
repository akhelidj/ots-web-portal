# ADR-0010 — REWORK child-report trigger becomes definition-driven

**Status:** Accepted (standing decision)

> **Update (a031969 — Phase C complete):** the plan below has shipped. The rules
> interpreter landed in 0a34b12 and the imperative body was retired in a031969, frozen as an
> equivalence oracle in test scope (`api/test/rework-imperative-oracle.ts`). The Context
> below describing the hardcoded body as the live sole authority is historical.

## Context

The REWORK child-report trigger was the **fourth and last** of the hardcoded
drill-pipe behaviors identified in [ADR-0009](0009-single-template-hardcode-seam.md).
The other three (approval gate, export, portal form) already read `Template.definitionJson`
live. The fourth did not: the rule is *authored* in the definition's `rules` block
(`rework-child-on-emi`: `body.emiResult == 'REWORK'` → upsert a `REWORK` child), but at the
time **no consumer read that block**. `child-reports.service.ts` (`syncReworkChildReport`)
was the sole authority via its hardcoded `body.emiResult === 'REWORK'` check. Because there
was no consumer, the hardcoded path was **not retireable by deletion** — removing it without
a `rules` consumer would have silently dropped child-report creation.

This ADR records the decision to build that consumer: a **rules interpreter** that reads
`definition.rules` and drives location 4. The design and its legacy-equivalence proof are
in [`../architecture/rework-rules-consumer.md`](../architecture/rework-rules-consumer.md).

## Decision

Location 4 becomes definition-driven via a rules interpreter that reads `definition.rules`.
Two sub-decisions fix the interpreter's contract:

**1. `upsertChildReport` is a named action; its reconciliation semantics are owned by the
interpreter, not declared field-by-field.** The action name `upsertChildReport` carries a
fixed body of behavior — draft-delete vs non-draft-empty, blank-create vs preserve-existing,
and version-bump timing — as an intrinsic property of the action, reproduced from
`syncReworkChildReport`. The definition declares only *what varies* per rule (the `when`
predicate, `childType`, `membership`, `reportNumberSuffix`, `forbidChildDisposition`), never
the reconciliation plumbing.

*Why not the alternatives:* pushing reconciliation mechanics into declarative fields bloats
the format and forces every future tool type to re-declare identical plumbing (delete-orphans,
create-blank, preserve-existing, bump-version). Owning the mechanics behind the action name
keeps the definition small and the behavior single-sourced.

**2. Unknown rule shape fails loud — throw and halt.** An unknown `action`, unknown `op`,
unknown `when.field`, unknown/invalid `childType`, or otherwise malformed rule causes the
interpreter to throw and halt. It does **not** fall back to `child-reports.service.ts`.

*Why not the alternatives:* falling back to the legacy `syncReworkChildReport` on an
unrecognized rule masks authoring errors — a typo in the definition would silently resolve
to hardcoded behavior — and keeps the hardcoded path half-alive indefinitely, defeating the
cutover. Fail-loud is consistent with the export computed-resolver allow-list, which likewise
rejects unknown tokens rather than degrading silently.

This preserves the parent/child REWORK asymmetry of [ADR-0007](0007-rework-asymmetry.md):
the interpreter keys child creation on parent `body.emiResult === REWORK`, and the child-side
REWORK rejection guard is unchanged and remains authoritative.

## Consequences

The REWORK trigger joined the other three locations as a live consumer of `definitionJson`,
so the definition is now the single authored source for all four drill-pipe behaviors, and
the hardcoded path was retired once the equivalence proof landed (a031969) — the imperative
body is now a frozen equivalence oracle in test scope, not a live path. The interpreter's
reconciliation contract is fixed by the action name, keeping the `rules` format minimal, and
authoring mistakes surface immediately rather than degrading to legacy behavior.

Per ADR convention, the standing downsides of this decision are **not** recorded here; they
are tracked in [`../KNOWN-ISSUES.md`](../KNOWN-ISSUES.md) when the consumer is built. This
ADR records the decision; the design, scenario matrix, and mutation-guard plan live in
[`../architecture/rework-rules-consumer.md`](../architecture/rework-rules-consumer.md).
