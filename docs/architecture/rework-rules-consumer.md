# REWORK Rules Consumer — Design & Test Plan

> **Status: design + test plan** (not yet built). Records the intended interpreter and its
> legacy-equivalence proof before implementation. Decision recorded in
> [ADR-0010](../adr/0010-rework-rules-consumer.md); preserves the asymmetry of
> [ADR-0007](../adr/0007-rework-asymmetry.md); this is location 4 of the four-location
> cutover framed in [ADR-0009](../adr/0009-single-template-hardcode-seam.md).

## Purpose

Build a rules interpreter that reads `definition.rules` and reproduces
`syncReworkChildReport` (`api/src/app/child-reports/child-reports.service.ts:24-151`)
**exactly**, so the REWORK child-report trigger becomes definition-driven like the other
three hardcoded locations.

**Key asymmetry vs locations 1–3.** The gate, export, and form cutovers each had *two live
paths* (legacy + engine) whose outputs could be diffed against each other on real traffic.
Location 4 had **no second live path**: `definition.rules` was **dormant JSON** — authored
but read by no consumer — and `syncReworkChildReport` was the **sole authority**. The proof
was therefore *"the interpreter reproduces the one method,"* not *"two live paths agree."*
Post-retirement (a031969), the interpreter is the **sole live path**; the imperative logic
survives only as a **frozen equivalence oracle** in test scope
(`api/test/rework-imperative-oracle.ts`), which is the comparand the interpreter is proven
against — the method itself is that oracle.

## `upsertChildReport` — fixed semantics

Reproduced precisely from `syncReworkChildReport`. The interpreter owns all of the following
as fixed behavior of the action name (per [ADR-0010](../adr/0010-rework-rules-consumer.md),
sub-decision 1); the definition declares only the varying fields.

**Match set.** Parent serials where `inspectionData.body.emiResult === REWORK`
(`SerialDisposition.REWORK`). This is the `when` predicate
(`body.emiResult`, `op: eq`, `value: REWORK`) applied per item (`scope: item`).

**Branch on (match set, existing REWORK child):**

| Match set | Existing REWORK child | Behavior |
|-----------|----------------------|----------|
| empty | none | **no-op**, return `null` |
| empty | DRAFT | **delete** child + its serial rows, return `null` |
| empty | non-DRAFT | **wipe serial rows, increment version, return mapped child** — do **not** delete the child |
| non-empty | none | **create** child: `DRAFT`, `version: 1`, `type: REWORK`; `reportNumber = parent.reportNumber + "_rework"` **only if** the parent has a `reportNumber` (else left undefined) |
| non-empty | exists | **reuse** the existing child's id |

**Reconciliation (single transaction), for the non-empty branch:**

1. Load existing `childReportSerialNumber` rows for the child; index by `serialNumberId`.
2. **Delete** rows whose serial is no longer in the match set.
3. **Create** rows for newly-matching serials **BLANK** — `inspectionData` and `disposition`
   are intentionally omitted (new serials start blank).
4. **Preserve** already-existing matching rows untouched (their `inspectionData`/`disposition`
   are not rewritten).
5. **Increment version only if the child pre-existed** (`existingChild` truthy). A freshly
   created child is not bumped again here.

After the transaction, re-read the child with attachments + serial rows and return the mapped
response (`mapChildReportResponse`).

## Fail-loud boundary

As in [ADR-0010](../adr/0010-rework-rules-consumer.md), sub-decision 2: an unknown `action`,
unknown `op`, unknown `when.field`, unknown/invalid `childType`, or malformed rule causes the
interpreter to **throw and halt**. It does **not** fall back to `syncReworkChildReport`.
Consistent with the export computed-resolver allow-list, which rejects unknown tokens rather
than degrading silently.

## Equivalence proof design

A harness runs **both** the frozen imperative oracle (`imperativeReworkOracle`, the retired
`syncReworkChildReport` body preserved verbatim in test scope) and the interpreter against
**independent identical seeded DB state**, across a scenario matrix, and asserts **identical
resulting DB state**. (Before retirement the method side was the live `syncReworkChildReport`;
the oracle was proven byte-identical to it before deletion.) Asserted dimensions:

- child **existence** (created / deleted / absent),
- child **status** (`DRAFT` / non-`DRAFT`),
- child **version**,
- serial-row **membership** (which `serialNumberId`s are linked),
- **preserved-vs-blank** rows (existing rows keep their data; newly-added rows are blank),
- child **reportNumber**.

### Scenario matrix

1. **No rework + no child** → no-op, no child created.
2. **No rework + DRAFT child** → child + serial rows deleted.
3. **No rework + non-DRAFT child** → serial rows wiped, version incremented, child retained
   and returned (not deleted).
4. **Some rework + no child** → child created (`DRAFT`, v1), matching rows linked.
5. **Set grows** → previously-absent matching serials added blank; existing rows preserved.
6. **Set shrinks** → newly-non-matching serials' rows deleted; remaining rows preserved.
7. **Set unchanged (idempotent re-sync)** → membership and preserved data stable; only the
   version-bump-if-preexisting behavior applies.
8. **Parent with no reportNumber** → child created with `reportNumber` left undefined (no
   `_rework` suffix synthesized from an absent parent number).
9. **False/0-is-valid coherence** → a serial with a **falsy-but-present** `emiResult` that is
   **not** `REWORK` (e.g. `PASS`, or an explicit non-REWORK value) must **not** match. Guards
   against a truthiness shortcut standing in for an explicit `=== REWORK` comparison.

## Mutation guard

For each proof, mutate **the interpreter's reading of `.rules`** and assert the equivalence
assertion now **FAILS**. A proof that stays green under mutation is vacuous (it wasn't
actually reading the rule). Mutations:

- flip `when.value` from `REWORK` to `PASS`,
- change `childType` (e.g. `REWORK` → `SCRAP`),
- drop `reportNumberSuffix` (`_rework`),
- corrupt `membership` (e.g. away from `allItemsMatching`).

Each mutation must break at least one asserted dimension (match set, child type/existence,
reportNumber, or membership) so the equivalence assertion goes red.

## Open questions

- **Rule selection.** Does the interpreter read `.rules[0]`, or filter by
  `action === "upsertChildReport"` (and/or by `childType`)? Drill pipe has exactly one rule.
  Zero `upsertChildReport` rules = tool type has no rework child reports (valid).
  Two-or-more = fail loud for now; multi-child semantics deferred until a real multi-rule
  tool type exists to design against.
- **Invocation point during the proof.** The proof calls **both** the frozen imperative
  oracle and the interpreter and compares results. Confirm there is **no shared mutable state
  bleed** when both run against the same DB — e.g. run each against an independent seeded state
  (separate transaction / reset between runs), since the first invocation mutates the child
  and serial rows the second would read.
