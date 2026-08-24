# Phase D — Flat (Region-less) Templates — Design Draft

**Status:** DRAFT — for review before any build. No code has been written. This
document designs the change; it does not make it.

**Goal.** Support genuinely flat templates: a report with **no repeating region** —
one record's worth of fields, laid out at fixed cells, exported as a real file. This
makes the export engine *general* (it handles both region-less and single-region
definitions) instead of implicitly drill-pipe-shaped, which is the point of the
project. Multi-region stays out of scope (still rejected).

**Builds on** the completed read-only trace (see the prior region-requirement
diagnosis). The confirmed blockers, not re-derived here:

- `engineMap` → `firstRegion(def)` throws `"export definition has no regions"`
  unconditionally, before any row/global work
  ([export-engine.ts:191-197,231](../../api/src/app/export/export-engine.ts#L191)).
- `export.service` returns **no file** when there are zero serials
  (`if (N === 0) return files` — [export.service.ts:397-406](../../api/src/app/export/export.service.ts#L397)).
- DTO/builder/validator require **exactly one** region + marker
  ([definition-authoring.types.ts:44-53](../../api/src/app/template/definition-authoring.types.ts#L44),
  [definition-builder.ts:38-42](../../api/src/app/template/definition-builder.ts#L38),
  [definition-validator.ts:92-101](../../api/src/app/template/definition-validator.ts#L92)).
- Describe-row `scope` defaults to `'header'` → the silent empty-form trap
  ([template-define.component.ts:123](../../portal/src/app/features/templates/components/template-define/template-define.component.ts#L123)).
- `definitionToFormSchema` keeps only item-scope fields, dropping header-scope as
  "live elsewhere"
  ([definition-to-form-schema.ts:53](../../portal/src/app/features/templates/schemas/definition-to-form-schema.ts#L53)).

---

## 0. The load-bearing discovery — the OOXML layer already does region-less

The single most important fact for scoping and risk: **the fragile raw-OOXML
row-cloning code needs no new lines.** `expandRegionAndSubstitute`
([xlsx-token-engine.ts:174-306](../../api/src/app/export/mappings/xlsx-token-engine.ts#L174))
already runs its two phases independently:

- **Row expansion (steps 4–5, the fragile regex row-cloning)** is *guarded*:
  `if (templateRowNumber !== -1 && chunk.length > 0)`
  ([:218](../../api/src/app/export/mappings/xlsx-token-engine.ts#L218)). If no marker
  row is found **or the chunk is empty**, the entire clone/shift/shared-string-remap
  block is skipped.
- **Global substitution (step 6)** runs *unconditionally* afterward
  ([:284-288](../../api/src/app/export/mappings/xlsx-token-engine.ts#L284)) — it
  replaces every `globalTokens` key directly in `sharedStrings.xml`.

So a flat export is *already expressible* at the machinery level: call
`expandRegionAndSubstitute` with an **empty chunk** and a `globalTokens` map carrying
the flat fields. The clone path is never entered; only the global substitution runs.
The change is therefore confined to the **callers** (`engineMap`, `export.service`)
and the **authoring/validation/form** layers — the byte-emitting regex code is
untouched, which is exactly what ADR-0005's structural-equivalence proof most needs.

> ⚠️ One concrete trap to design around: an **empty-string marker matches every
> cell** — `ssPlain[idx].includes('')` is always `true`
> ([:208](../../api/src/app/export/mappings/xlsx-token-engine.ts#L208)) — so it would
> set `templateRowNumber` to the first text row. The empty **chunk** still saves us
> (the `&& chunk.length > 0` guard), but the flat path must **pass `chunk: []`**, not
> merely an empty marker, to be safe regardless of marker. This is designed in §1.

---

## 1. Region-less export

### 1a. The flat data model — one serial, zero, or a record? (DECISION FORK #1)

A flat report is "one record's worth of data with no repeating rows." The whole
existing pipeline — approval gate, revision snapshot, the inspection form, serial
CRUD — is **serial-based**. The least-invasive question is *where the one record's
data lives*, because that determines how many subsystems change.

| Subsystem | Flat = **one serial** (record carried by a single `SerialNumber`) | Flat = **zero serials** (data in report header) |
|---|---|---|
| Export `engineMap` | changes (region-optional) | changes (region-optional) |
| Export zero-serial early-return | unchanged (N=1 takes the single-file branch) | **changes** (N=0 must still emit a file) |
| Approval gate `engineGate` (≥1 serial → else `empty`, [approval-gate.ts:82](../../api/src/app/workflow/approval-gate.ts#L82)) | unchanged (1 ≥ 1) | **changes** (0 serials must be allowed for flat) |
| Revision snapshot (captures `serialNumbers[]`) | unchanged (captures the 1) | unchanged (captures `[]`) |
| Inspection form (edits one serial's `inspectionData`) | **unchanged — reused wholesale** | **changes** (need header-field editing + a new save path) |
| Report create / serial seeding | small (ensure exactly one record row) | **changes** (fields have nowhere to be stored) |
| Field data storage | the record serial's `inspectionData` (arbitrary keys already work) | report `header` columns — **only the fixed drill-pipe columns exist**; arbitrary flat fields have no column |

**Recommendation: Model B-one — a flat report has exactly ONE record, modeled as one
`SerialNumber` row ("the record").** Its fields are stored in that serial's
`inspectionData` (arbitrary keys already supported), and the engine writes them at
fixed cells (no marker row). This matches the user's own framing ("a report about ONE
serial"), reuses the gate, snapshot, form, and save path verbatim, and confines the
change to the export engine + authoring/validation/form-adapter.

The word "header-scope" in the original framing is reinterpreted as **layout**, not
storage: a flat field is *placed like a header token* (fixed cell, global
substitution) while its *value* lives in the single record. This decouples the two
axes the engine currently conflates:

- **Layout axis** — token at a fixed cell (global substitution) vs. in a cloned
  marker row (region).
- **Storage axis** — value in report header/global data vs. in a per-record serial.

Today: header-scope ⇒ fixed cell **and** header storage; item-scope ⇒ marker row
**and** serial storage. Flat templates need *fixed-cell layout* + *serial storage* —
a combination the engine can't currently express. §3 designs the authoring shape that
expresses it; this section designs the export that consumes it.

> **Alternative if the reviewer prefers literal "header-only":** Model B-zero (data in
> report header). Rejected as the recommendation because arbitrary header fields have
> **no storage** (the `InspectionReport` row has a fixed column set) and it forces
> four subsystems to change including a brand-new form save path — a much larger,
> riskier surface for the same user-visible result.

### 1b. `engineMap` / `firstRegion` become region-optional

Design (prose, no code):

- **`firstRegion` → `optionalRegion`**: return `def.regions[0] ?? null` instead of
  throwing. The throw is *removed*, not relocated — a region-less definition is now
  valid input, not an error.
- **`engineRowTokenKeys` / `engineRowTokens`**: when `optionalRegion` is `null`,
  return `[]` / `{}`. In the flat path these are never called (no rows), but making
  them total keeps the dry-run (§3) and any future caller safe.
- **`engineMap` branches on region presence:**
  - **Region present (unchanged path):** compute `firstRegion`, `rowTokenKeys`,
    `rowTokensFor`, and call `expandRegionAndSubstitute(workbook, chunk, {...})`
    exactly as today. *Byte-identical to current behavior* (§2 proves this).
  - **Region absent (new flat path):** call
    `expandRegionAndSubstitute(workbook, [] /* empty chunk */, { marker: <never-match sentinel>, rowTokenKeys: [], globalTokens, rowTokensFor: noop })`.
    The empty chunk skips the clone block; step 6 applies `globalTokens`. `globalTokens`
    is resolved by a **flat resolver** (§1c).

No new raw-OOXML code. The flat branch reuses `expandRegionAndSubstitute` in its
already-supported no-expansion mode.

### 1c. Resolving the flat token map

For Model B-one, the flat field values live in the single record serial's
`inspectionData`, but are *placed globally*. So the flat path's `globalTokens` is the
union of:

- **true header/global tokens** — `engineGlobalTokens(def, snapshot)` unchanged
  (report metadata, computed tokens); plus
- **the record's fields** — resolved from the one serial's `inspectionData` using the
  same `resolveValue` reader already used for rows
  ([export-engine.ts:140-169](../../api/src/app/export/export-engine.ts#L140)), but
  emitted into the *global* map instead of a per-row map.

Concretely: the builder (§3) places flat fields' export entries into
`export.global` with a `source` that reads the record serial (analogous to today's
`rowSerial` source), so `engineGlobalTokens` — or a thin flat variant of it — resolves
them against the single record. This keeps one resolver, one substitution step, one
code path for "write a token at a fixed cell," shared with the proven region-global
path.

> **DECISION FORK #2 — flat field data source.** (a) *Record serial's
> `inspectionData`* (recommended; arbitrary keys, reuses the form + save + gate). (b)
> *Report header columns* (only the fixed columns exist; needs schema growth for any
> new field). The recommendation is (a); §3's builder shape and §2's flat oracle
> assume it. If the reviewer picks (b), §3's builder emits plain `field` entries
> against `snapshot.header` and the form work in §4 grows a header-editing surface.

### 1d. The zero-serial early return

Under Model B-one a flat report has **one** serial, so `N = 1`, `N <= chunkSize`, and
`export.service` takes the existing single-file branch
([export.service.ts:408-427](../../api/src/app/export/export.service.ts#L408)) with no
change. The `if (N === 0) return files` guard
([:404](../../api/src/app/export/export.service.ts#L404)) stays as-is — it correctly
means "a report with no records produces no file," which remains true for both flat
and region reports.

`chunkSize` derivation reads `definition.regions?.[0]?.chunkSize`
([:401-402](../../api/src/app/export/export.service.ts#L401)); for a region-less
definition this is `undefined → POSITIVE_INFINITY` ("never split") — correct for a
one-record flat report, no change needed.

> If the reviewer instead chooses Model B-zero, **this guard must change**: a flat,
> zero-serial report must still emit one global-only file. That is the single largest
> reason Model B-one is recommended — it leaves the most fragile service untouched.

---

## 2. Equivalence-proof strategy (the load-bearing section)

The bar: **the existing region/drill-pipe export must be proven byte-for-byte
unchanged** (structural, per ADR-0005 — not hash/golden, because `reportNumber`,
`{{reportDate}}`, ExcelJS `docProps`, and ZIP entry timestamps are volatile), **while
the new flat path is added and proven correct against an oracle that doesn't yet
exist** (there is no legacy flat template). This section gets the most detail; the
engine change should not be approved without it.

### 2a. What the current proof already gives us

Two layers exist and are the foundation:

- **Layer A — value equivalence (unit, exhaustive, frozen golden).**
  `export-engine.equivalence.spec.ts` feeds the **real** drill-pipe definition to
  `engineGlobalTokens` / `engineRowTokens` and asserts the token maps equal a
  **frozen golden** — a verbatim, self-contained copy of the retired legacy
  computation that *shares no helper* with the engine (so a shared-helper bug can't
  make it pass vacuously) and has its own **mutation guard** proving the comparison is
  non-vacuous ([export-engine.equivalence.spec.ts:34-40,476-493](../../api/src/app/export/export-engine.equivalence.spec.ts#L34)).
- **Layer B — structural behavior (integration, real workbook).**
  `export-engine.integration.spec.ts` exports a real approved report through the real
  `ExportService`/`engineMap`/`expandRegionAndSubstitute`, canonicalizes with
  `canon()` (cell text by address, per-sheet `maxRow`, sorted merges, filename,
  mimetype — **decoding never reads `docProps`/ZIP metadata, so ADR-0005 volatiles are
  excluded by construction**, [:144-208](../../api/src/app/export/export-engine.integration.spec.ts#L144)),
  and has four mutation/soundness guards (transform, token-mapping, chunkSize, and a
  volatile-only normalization check, [:284-329](../../api/src/app/export/export-engine.integration.spec.ts#L284)).

The strategy strengthens both to *pin the region path against a pre-change baseline*
and *specify the flat path by construction*.

### 2b. Proving the region path is untouched

Two mechanisms, both required:

1. **Branch isolation (design-level argument).** The flat path is entered **only** when
   `def.regions` is empty. Every region definition (including the sole live one,
   drill-pipe) has `regions.length === 1` and therefore traverses the *identical*
   `engineMap` region branch and the *identical* `expandRegionAndSubstitute` call it
   does today. The only shared edit is turning `firstRegion`'s throw into an
   optional return — which, on a present region, returns the same object as before.
   So region exports are unchanged *by construction*; the tests below make that
   claim falsifiable.

2. **Frozen structural baseline (new — the load-bearing regression pin).** Before
   touching `engineMap`, capture the current region export's `canon()` output for a
   representative report into a **committed fixture** (`canon` JSON: `{cells, maxRow,
   merges, filename, mimetype}` for the single-file case, and the parts map for a
   multi-part zip). Add a spec that exports the same seeded report through the
   post-change engine and asserts the canon **deep-equals the frozen fixture**. This
   upgrades the guarantee from "Layer B still passes" (which only compares live
   re-exports to each other) to "the region export structure is identical to a
   snapshot taken *before* the change" — catching any accidental drift in the shared
   step-6 global substitution that flat and region both exercise. ADR-0005-compliant:
   `canon()` already excludes timestamps, so the frozen fixture contains no volatile
   bytes.

   - **Non-vacuity of the frozen baseline:** prove the fixture *discriminates*. Reuse
     an existing mutation (e.g. `boolCheckbox` `X→Y`, GUARD 1) but compare the mutant
     canon against the **frozen fixture** and assert **divergence**. If a real
     mutation still equals the fixture, the fixture is too coarse and the pin is
     worthless — this test forbids that.
   - Keep the **entire existing Layer A and Layer B suites green verbatim** as a
     second, independent regression signal. No edits to the golden, the drill-pipe
     definition, or the canonicalizer.

### 2c. The oracle for the new flat path (no legacy comparand)

There is no pre-existing flat export to diff against, so the flat oracle is
**specification-by-construction + independent recomputation**, mirroring how Layer A
built an independent golden rather than importing the engine:

1. **Synthetic flat fixture with known cell placements.** Author a tiny `.xlsx`
   fixture with a handful of tokens at *known* addresses and **no marker row** (e.g.
   `{{poNumber}}` at `B2`, `{{casingWeight}}` at `D4`). This fixture is the oracle's
   substrate — its structure is fully known by construction.

2. **Cell-placement assertion (Layer B-flat, structural).** Export a flat report
   built on that fixture through the real `ExportService`, `canon()` it, and assert:
   - each flat token's **cell now holds the resolved value** (hand-authored expected
     map — a *specification*, valid because the behavior is new);
   - **`maxRow` equals the template's `maxRow`** — the defining structural signature
     that *no rows were cloned or shifted*. (A region export of N serials has
     `maxRow = templateMaxRow + (N − 1)`; the flat export must equal `templateMaxRow`
     exactly. This is the single assertion that proves the fragile clone path was
     skipped.)
   - every **non-token cell is byte-identical** to the source fixture (no collateral
     edits).

3. **Value-equivalence assertion (Layer A-flat, unit).** Feed the flat definition +
   the one record to the flat resolver and assert the produced global token map equals
   a **hand-constructed expected map**. Cover the same edge classes Layer A does
   (empty/`whenEmpty` fallbacks, `'0'`/whitespace kept, boolean/date rendering) so the
   flat path's `resolveValue` usage is exhaustively pinned without a live workbook.

4. **Shared-path reuse invariant (differential — ties flat correctness to the proven
   region path).** Because flat and region **both** resolve fixed-cell tokens through
   the same `resolveValue` + step-6 substitution, prove they agree on that shared
   behavior: give a flat template and a region template the *same* global token value
   (e.g. `{{poNumber}} = 'PO-9'`) and assert the rendered cell text is identical in
   both exports. This borrows the region path's existing credibility for the half of
   the flat path that is genuinely shared, leaving only the "skip expansion" half to
   the structural `maxRow` assertion in (2).

### 2d. Mutation guards for the flat path (non-vacuity)

- **Mapping mutation:** change a flat field's `export.global` binding to a
  non-existent field and assert the flat canon **diverges** (value goes empty) — the
  flat analogue of GUARD 2. Proves the flat assertions aren't vacuously matching.
- **No-expansion guard:** assert that a flat definition, even when its data or a stray
  marker string is present, produces `maxRow === templateMaxRow` (no multiplication).
  This is the guard that the clone branch stays unreached — the property most likely
  to regress if a later change reintroduces a matching marker.
- **Cross-contamination guard:** in one run, export a region report and a flat report
  against the same engine build and assert the region canon still equals the §2b
  frozen fixture. Proves adding the flat branch didn't perturb the region branch at
  runtime, not just in source.

### 2e. Summary of the proof obligation

| Claim | Mechanism | Oracle | Non-vacuity |
|---|---|---|---|
| Region values unchanged | Layer A verbatim green | frozen legacy golden | existing mutation guard |
| Region structure unchanged | **new** frozen `canon` baseline | pre-change canon fixture | mutant ≠ frozen fixture |
| Flat values correct | Layer A-flat unit | hand-built expected map | mapping mutation diverges |
| Flat structure correct | Layer B-flat integration | synthetic fixture + `maxRow` | no-expansion + mapping guards |
| Flat reuses proven substitution | differential region-vs-flat | region path itself | shared-value equality |
| Adding flat didn't perturb region | cross-run guard | frozen fixture | region canon == fixture after flat added |

---

## 3. Authoring made region-optional

### 3a. DTO / builder / validator

- **DTO** ([definition-authoring.types.ts:44-62](../../api/src/app/template/definition-authoring.types.ts#L44)):
  `region` becomes **optional**. Add an explicit template-shape discriminator rather
  than inferring flatness from `region == null` — a single boolean/enum
  (`layout: 'flat' | 'region'`, or `repeating: boolean`) authored by the UI (§5), so
  intent is explicit and the server never has to guess. A flat DTO carries `fields`
  (all fixed-cell) and no `region`; a region DTO is exactly today's shape.
- **Builder** ([definition-builder.ts:31-127](../../api/src/app/template/definition-builder.ts#L31)):
  - Region DTO → unchanged output (`regions: [one]`, marker seeded as `rowSerial`,
    item fields into `export.regions`).
  - Flat DTO → `regions: []`; **all** fields become `export.global` entries. Under
    Model B-one the record's fields carry the record-reading `source` (§1c) so the
    engine resolves them against the single serial; true metadata/computed tokens are
    plain `field`/`computed` globals as today. `sections` still derive from field
    grouping so the form (§4) can render them.
  - The structural guards that currently throw on a missing region/marker
    ([:38-42](../../api/src/app/template/definition-builder.ts#L38)) move **behind the
    discriminator**: required for `region` templates, absent for `flat`.

- **Validator** ([definition-validator.ts:88-176](../../api/src/app/template/definition-validator.ts#L88)):
  - **Check 6** "exactly one region" → "**zero or one** region"; `regions.length > 1`
    still rejected (multi-region remains unsupported). For a flat definition,
    `regions.length === 0` is now valid.
  - **Marker existence** (part of the `tokens-exist` check, via `referencedTokens`
    pulling `r.marker` for each region, [:78-86](../../api/src/app/template/definition-validator.ts#L78)):
    naturally a no-op when `regions` is empty (no markers to check). No change beyond
    check 6 allowing zero regions.
  - **Engine dry-run (check 7)** ([:157-173](../../api/src/app/template/definition-validator.ts#L157)):
    today calls `engineRowTokenKeys` / `engineRowTokens`, which call `firstRegion`
    (throws on zero regions). Once those are region-optional (§1b) they return `[]`/`{}`
    for a flat candidate; the dry-run must **also exercise the flat `engineMap` global
    path** so a flat definition is validated through the very resolver export will run
    — extend the dry-run to call the flat resolver against `DRY_RUN_SNAPSHOT` +
    `DRY_RUN_SERIAL`. The gate dry-run (`engineGate`) is already region-agnostic
    ([approval-gate.ts:78-113](../../api/src/app/workflow/approval-gate.ts#L78)) and
    needs no change.
  - Checks 2–5 (renderable types, boolean `required`, select options, computed
    allow-list) are field-level and unaffected.

### 3b. What breaks when `regions` is empty — and how each adapts

| Consumer | Assumes a region? | Adaptation |
|---|---|---|
| `engineMap` / `firstRegion` | **yes — throws** | §1b: optional region, flat branch |
| `engineRowTokenKeys` / `engineRowTokens` | yes (`firstRegion`) | return `[]`/`{}` when region absent |
| `export.service` chunkSize | reads `regions?.[0]?.chunkSize` (null-safe) | already tolerant → `Infinity` (never split) |
| Validator check 6 | requires exactly 1 | allow 0 or 1 |
| Validator marker existence | iterates `regions` | no-op on empty |
| Validator dry-run | calls row readers | readers total; add flat global dry-run |
| Approval gate | no (reads `fields`/`disposition`) | unchanged |
| Revision snapshot binding | no (checks key/version/hash present, [revision.service.ts:64-72](../../api/src/app/revision/revision.service.ts#L64)) | unchanged |
| Form-schema adapter | filters item-scope | §4 |

---

## 4. Form render for header-only (flat) templates

Today `definitionToFormSchema` keeps **only** item-scope fields
([definition-to-form-schema.ts:53](../../portal/src/app/features/templates/schemas/definition-to-form-schema.ts#L53)),
because in a region template the header fields legitimately live elsewhere (report
metadata, not the per-serial form). For a flat template the fields **are** the form,
so the adapter must render them — without changing region behavior.

**The adapter must be told which mode it's in**, not guess. Design: the definition
carries the same explicit `layout`/`repeating` discriminator authored in §3/§5, and it
flows to the portal inside `Template.definitionJson` (already delivered embedded in the
`GET /inspection-reports` payload and typed as `TemplateFormDefinition`,
[definition-to-form-schema.ts:8-36](../../portal/src/app/features/templates/schemas/definition-to-form-schema.ts#L8)).

- **Region template (`layout: 'region'`):** adapter unchanged — item-scope fields
  become the per-serial form; header fields stay out (rendered as report metadata
  elsewhere). *Proven-equivalent to `DRILL_PIPE_V1_SCHEMA` today; must stay so.*
- **Flat template (`layout: 'flat'`):** adapter builds the form from the **flat
  fields** (grouped by `section` exactly as it groups item fields today), so a
  header-only definition renders its fields instead of an empty form. Under Model
  B-one the fields are stored per-record, so the existing
  `SerialInspectionReactiveFormComponent` and its `saveData` → serial `inspectionData`
  path are **reused unchanged** — the flat form edits the single record serial like any
  other serial.

**Do not rely on the "present definition + zero sections" state.** The
current fallback switch treats a present-but-empty schema as a *rendered empty form*
(`schemaUnavailable` stays false, [serial-inspection-reactive-form.component.ts:75-88](../../portal/src/app/features/inspections/components/serial-inspection-reactive-form/serial-inspection-reactive-form.component.ts#L75))
— which is the silent-empty-form trap. With an explicit `layout` discriminator the
adapter knows a flat template *should* have fields and can surface a real error if it
has none, rather than rendering a blank form. The `schemaUnavailable` empty-state
([serial-inspection-reactive-form.component.html:1-13](../../portal/src/app/features/inspections/components/serial-inspection-reactive-form/serial-inspection-reactive-form.component.html#L1))
remains for the genuinely-undefined-template case.

**Distinguishing test:** a spec proving the adapter renders a flat definition's fields
as form controls **and** still reproduces `DRILL_PIPE_V1_SCHEMA` verbatim for the
region definition (the existing `definition-to-form-schema.spec.ts` equivalence must
stay green) — i.e. the mode switch changes flat behavior without touching region
behavior.

---

## 5. The UI (describe screen)

Keep the **submit-and-surface** contract (server gate is the sole authority; the
client does not reimplement the seven checks — [template-define.component.ts:22-27](../../portal/src/app/features/templates/components/template-define/template-define.component.ts#L22)).
The UI changes are about *not inviting a click the server will reject* and *not
steering authors into empty forms*.

1. **Explicit "does this template have repeating rows?" choice.** A required top-level
   toggle (Repeating region vs. Flat / single record) that sets the `layout`
   discriminator. This replaces the implicit "you must pick a marker" and drives which
   controls show:
   - **Region:** show the marker select + region id/label (today's controls).
   - **Flat:** hide the marker/region controls entirely; the fields are the whole
     definition. No marker to choose, so the empty-form trap can't arise.
2. **Fix the button-active-then-rejected bug.** Today Save is
   `[disabled]="isSubmitting()"` only ([template-define.component.html:235](../../portal/src/app/features/templates/components/template-define/template-define.component.html#L235))
   — enabled even with an unset marker, so the first click is spent learning it's
   invalid. Disable Save when the form is **structurally** incomplete by the client's
   own light niceties (region mode: marker chosen, region id present, ≥1 described
   field, every included field labelled — the checks already in `submit()`
   [:192-210](../../portal/src/app/features/templates/components/template-define/template-define.component.ts#L192);
   flat mode: ≥1 field, every included field labelled). This is the *same* pattern the
   inspection form already uses correctly (`[disabled]="formGroup.invalid"`,
   [serial-inspection-reactive-form.component.html:125](../../portal/src/app/features/inspections/components/serial-inspection-reactive-form/serial-inspection-reactive-form.component.html#L125)) —
   bring the describe screen in line. Server rejection of *semantic* problems still
   surfaces inline (unchanged); the button only guards the client-checkable minimum.
3. **Stop the `scope` default from producing empty forms.** In region mode, defaulting
   every row to `'header'` yields a region with only the marker and zero item fields →
   empty per-serial form. Options (fork #3): (a) default new rows to `'item'` in region
   mode; (b) require the author to resolve scope before Save (block on "0 item fields
   in a region template"); (c) in flat mode the axis disappears (all fields are
   fixed-cell), so the trap only needs solving for region mode. Recommend **(a)+(b)**:
   sensible default *and* a client nicety that blocks a region template with no item
   fields, since that is always an authoring mistake.

Zoneless note: any new view state the template branches on and that is mutated after
async work must be a **signal** (repo convention — this component was just converted
for exactly this reason; see the `isLoading`/`rows` signals and the
`template-define.render.spec.ts` regression). `[(ngModel)]` fields stay plain.

---

## Structural dependency map (cross-app, live-vs-oracle)

- **Backend, live path:** `PUT /templates/:id/definition` → `TemplateDefinitionService`
  → `buildDefinition` → `validateDefinition` (7 checks incl. engine dry-run) → write
  `definitionJson` ([template-definition.service.ts:36-98](../../api/src/app/template/template-definition.service.ts#L36)).
  `GET /inspection-reports` embeds `definitionJson` for the portal. Export:
  `ExportService.exportInspectionReport` → `applyMapping` → `engineMap` →
  `expandRegionAndSubstitute`.
- **Frontend, live path:** describe screen (`admin/templates/:id/define`) authors the
  DTO; inspection detail renders `SerialInspectionReactiveFormComponent` from the
  embedded definition via `definitionToFormSchema`.
- **Cross-app contract (no shared DTO — ADR-0008):** `DefineTemplateDto` is duplicated
  in `admin-templates.service.ts` (portal) and `definition-authoring.types.ts` (api).
  The `layout`/`repeating` discriminator must be added to **both** in lockstep, and to
  the portal's `TemplateFormDefinition`. This is the classic drift risk; call it out in
  the build steps.
- **Oracles vs. live:**
  - Region correctness oracle = frozen legacy golden (Layer A) + frozen `canon`
    baseline (new, Layer B) — both independent of the engine.
  - Flat correctness oracle = hand-authored synthetic fixture + hand-built expected
    token map (specification-by-construction) + differential reuse of the region path.
  - Determinism boundary = ADR-0005 structural (`canon` excludes `docProps`/ZIP/
    `reportNumber`/`{{reportDate}}`).

---

## Build order (smallest provable steps; engine equivalence proven before authoring can express a flat definition)

The ordering invariant: **never create a state where a flat definition is expressible
but crashes on export.** So the engine must accept region-less definitions *and be
proven* before the authoring layer is allowed to emit one.

1. **Freeze the region baseline (no product change).** Add the §2b frozen `canon`
   fixture + the "mutant ≠ fixture" non-vacuity guard against *today's* engine. This is
   the safety net every later step is checked against. Ships green with zero behavior
   change.
2. **Make the engine region-optional (backend only, still unreachable).**
   `firstRegion` → optional; `engineMap` flat branch; row readers total. Prove: all
   existing Layer A/B suites green verbatim; frozen baseline still matches; add
   Layer A-flat unit + Layer B-flat structural (synthetic fixture, `maxRow`, mapping
   & no-expansion guards) + the differential reuse test. **No authoring path can emit a
   flat definition yet**, so this is inert in production but fully proven.
3. **Relax validation (backend).** Check 6 → "zero or one"; extend the dry-run to the
   flat global path. Prove with validator specs: a flat candidate validates; a
   multi-region candidate still fails; a region candidate is unchanged.
4. **Relax the builder + DTO discriminator (backend + portal type, lockstep).** Add
   `layout`/`repeating` to both duplicated DTOs; builder emits `regions: []` for flat.
   Now a flat definition is *expressible end-to-end on the server* and — because steps
   2–3 are proven — it exports and validates rather than crashing.
5. **Form adapter (portal).** `definitionToFormSchema` renders flat fields in flat
   mode; region equivalence spec stays green.
6. **Describe-screen UI (portal).** Layout toggle, Save-disable fix, scope-default fix.
   Manual verification on the running app (no CI): author a flat template, define it,
   create a report, fill the record, approve, export — confirm a real one-record file.

Each step is independently green and reversible; the risky engine edit (step 2) lands
behind an unreachable branch with its full proof before any authoring change (step 4)
can reach it.

---

## Decision forks for the reviewer

1. **Flat data model — one serial vs. zero (§1a).** Recommended: **one record modeled
   as a single serial** (least invasive; reuses gate/snapshot/form/save). Alternative:
   zero serials, data in report header (touches four subsystems + new form save path).
2. **Flat field data source (§1c).** Recommended: **the record serial's
   `inspectionData`** (arbitrary keys, reuses the form). Alternative: report header
   columns (only fixed columns exist).
3. **`scope` default in region mode (§5).** Recommended: **default new rows to `item`
   *and* block a region template with zero item fields**. Alternatives: default-item
   only, or block-only.
4. **Discriminator representation (§3a).** `layout: 'flat' | 'region'` enum vs. a
   `repeating: boolean`. Enum is more extensible if a third layout ever appears;
   boolean is simpler. Recommend the enum.
5. **How strict is "flat"?** Does a flat template forbid item-scope fields entirely
   (pure fixed-cell), or is "flat" purely the absence of a region while fields may still
   be authored as a single record's own fields (recommended framing in §1a)? This
   determines whether the describe UI even shows a scope control in flat mode.

No code written; this is a draft for review.
