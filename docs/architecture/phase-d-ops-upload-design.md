# Phase D — Ops-Authored Template Upload & Definition Authoring (DESIGN DRAFT)

> **Status:** DRAFT for review. No code written. Design-only pass.
> **Goal:** A non-technical ops admin uploads ANY tokenized `.xls`/`.xlsx` template
> (20–36+ tool types, bilingual FR/EN — **not** just drill pipe), the app reads the
> tokens out of the workbook, ops describes each field in-app (label / type / required /
> options / header-vs-item scope), and a valid `definitionJson` is written to the
> `Template` row — **the same shape the engine already consumes**. No developer in the loop.

This builds on the structural investigation already completed. It does **not** re-derive
those findings; it cites them and designs on top. Key inherited facts:

- `POST /templates` already stores `fileBlob` + `hash` and auto-versions/deprecates, but
  lands `definitionJson = NULL`. The missing seam is **deriving/writing `definitionJson`
  after the row exists** — [`template.service.ts`](../../api/src/app/template/template.service.ts).
- ExcelJS is installed (api-side, hoisted, `^4.4.0`); SheetJS (`xlsx`) is **not installed
  anywhere** — needed for `.xls`→`.xlsx` at the door.
- A full admin-upload UI already exists ([`admin-templates.component.ts`](../../portal/src/app/features/templates/components/admin-templates/admin-templates.component.ts),
  [`admin-templates.service.ts`](../../portal/src/app/features/templates/services/admin-templates.service.ts),
  route `templates`). Upload is online-only, raw HTTP.
- `definitionJson` has one real writer today ([the backfill script](../../api/scripts/backfill-drill-pipe-definition.ts))
  plus test seeds. **No live derivation path.**
- The engine is strict / fail-loud because the only definition today is the trusted
  drill-pipe one. **An ops-authored definition is UNTRUSTED input.** This is the central
  risk of Phase D.

---

## 0. The consumers of `definitionJson` (the contract we must not break)

Everything below is designed to feed these five existing readers **unchanged**. This is
the whole point — the ops-authored definition must be the *same shape* they already read.

| Consumer | File | Slice it reads | Failure mode today if off-shape |
|---|---|---|---|
| **Export engine** | [`export-engine.ts`](../../api/src/app/export/export-engine.ts) (via [`export.service.ts:257-294`](../../api/src/app/export/export.service.ts)) | `transforms`, `regions`, `export.global`, `export.regions` | Throws mid-export: `Unknown transform`, `Unsupported transform kind`, `export definition has no regions`; `null` definition → `InternalServerErrorException` |
| **Approval gate** | [`approval-gate.ts`](../../api/src/app/workflow/approval-gate.ts) (via [`inspection-report-workflow.service.ts:311-326`](../../api/src/app/workflow/inspection-report-workflow.service.ts)) | `fields[].{key,scope,required}`, `disposition.{requiredForApproval,source}` | Reads defensively (optional chaining, `?? []`); mostly tolerant but assumes each field has `key`/`scope`/`required` |
| **Rework rules** | [`child-reports.service.ts:48-77`](../../api/src/app/child-reports/child-reports.service.ts) → `reworkRulesInterpreter.syncFromRules` | `rules[]` | `null` definition → `PreconditionFailedException` |
| **Portal form** | [`serial-inspection-reactive-form.component.ts:52-59`](../../portal/src/app/features/inspections/components/serial-inspection-reactive-form/serial-inspection-reactive-form.component.ts) via [`definition-to-form-schema.ts`](../../portal/src/app/features/templates/schemas/definition-to-form-schema.ts) | `sections`, item-scope `fields[].{key,label,type,required,options,section}` | Malformed → `definitionToFormSchema` throws → **caught, falls back to `DRILL_PIPE_V1_SCHEMA`** (see §5 — this fallback is itself a hazard for non-drill-pipe) |
| **Portal readiness validation** | [`report-validation.service.ts:126-147`](../../portal/src/app/core/validation/services/report-validation.service.ts) | same as form (reuses `definitionToFormSchema`) | Soft-NULL: throw → falls back to `DRILL_PIPE_V1_SCHEMA` |

**Delivery path** (traced, §6): the written column is joined into the report list payload
by [`inspection-reports.service.ts:67-92`](../../api/src/app/inspection-reports/inspection-reports.service.ts),
hydrated to IndexedDB as `LocalInspectionReport.definitionJson`, and consumed by the
portal form + validation. Gate/export/rework read the `Template` row **directly** server-side.

**Structural consequence:** if the write produces a shape these five already accept, Phase D
needs **zero new plumbing on the consumer side**. All Phase D novelty is *upstream* of the
column: extraction, authoring UI, and write-time validation.

---

## 1. The derivation seam — SEPARATE "define" endpoint (CONFIRMED, with reasoning)

**Decision: confirm the lean. Add a separate authoring endpoint; leave the byte-storage /
hash / versioning path untouched.**

### Proposed shape

Two new endpoints on the existing admin-only `TemplateController` (already
`@Roles(UserRole.ADMIN)` + `RolesGuard`):

- `GET  /templates/:id/tokens` — reads the stored `fileBlob`, extracts the token inventory
  (see §2), returns it to the portal for ops to describe. **Read-only, idempotent, no
  mutation.**
- `PUT  /templates/:id/definition` — accepts the ops-authored definition, **validates it**
  (see §5), and writes `definitionJson` on that row via a guarded `updateMany`
  (`where: { id, version }` — optimistic concurrency per the repo spine).

Upload (`POST /templates`) is **unchanged**. A newly uploaded template row exists with
`definitionJson = NULL` — exactly as today — and is simply *undefined* until ops completes
the define step.

### Why separate, not folded into upload

1. **Byte path is proven and audited; don't perturb it.** `createTemplate` runs inside one
   transaction doing version-compute + auto-deprecate + insert + two audit logs
   ([`template.service.ts:40-117`](../../api/src/app/template/template.service.ts)). Folding
   a multi-step, human-in-the-loop authoring flow into it would either (a) block the
   transaction on human input (impossible) or (b) require the definition to be fully formed
   at POST time — which it can't be, because ops describes the fields *after* seeing the
   extracted tokens.
2. **The two operations have different lifetimes.** Upload is one HTTP request. Authoring is
   an interactive session: extract → ops fills a form → submit. These cannot share a request.
3. **Re-authoring without re-uploading.** A separate `PUT` lets ops fix a definition
   (wrong label, missed a required flag) *without* minting a new template version and
   re-deprecating the prior one. Folding into upload would force a version bump for every
   definition edit — churning `templateVersion` and orphaning in-flight reports pinned to
   the old version.
4. **Clean untrusted-input boundary.** The `PUT` is the single choke point where an
   untrusted definition is validated before it can reach any consumer. One endpoint to
   harden (§5) instead of a branch inside the audited upload transaction.

### The one fork this creates (see §7)

A template can exist in an **"uploaded but undefined"** state (`definitionJson = NULL`). We
must decide what that state *means* for report creation — today a NULL definition is a
server *misconfiguration* that trips `PreconditionFailedException` in rework and export.
**Fork D-1** below.

### Structural dependencies touched

- **New:** `GET /templates/:id/tokens`, `PUT /templates/:id/definition` on
  `TemplateController`. Both admin-only (inherit the class guards).
- **New service methods** on `TemplateService` (or a new `TemplateDefinitionService` — see
  §7 Fork D-7) that read `fileBlob` and write `definitionJson`. Reuse `PrismaService`.
- **Reuses:** `TemplateFileStoreService.getFile` already exists to pull `fileBlob` by id
  ([`template-file-store.service.ts:28-39`](../../api/src/app/template/template-file-store.service.ts)) — the token extractor consumes it.
- **Portal:** `AdminTemplatesService` gains `getTokens(id)` + `saveDefinition(id, def)`;
  a new authoring component/route. All online-only, raw HTTP (consistent with existing
  upload).

---

## 2. Token extraction — api-side (ExcelJS + raw OOXML, reuse existing machinery)

### What "reading the tokens" means concretely

Tokens are `{{...}}` literals living in the workbook's **shared strings**, exactly as the
export engine already finds them. The extractor is the *inverse* of
[`xlsx-token-engine.ts`](../../api/src/app/export/mappings/xlsx-token-engine.ts): instead of
substituting tokens, it enumerates them and reports their location.

Concrete algorithm (all machinery already exists in the export path — reuse, don't reinvent):

1. **Unzip** the `.xlsx` with `JSZip` (already a dependency, used by the token engine).
2. **Parse `xl/sharedStrings.xml`** with the existing `parseSharedStrings` — returns the
   plain-text of every `<si>` string.
3. **Scan the worksheet** `xl/worksheets/sheet1.xml` row-by-row (existing `rowRegex` +
   `getSharedStringIndicesForRow`) to map each token-bearing cell to its **row number** and
   **column**.
4. **Regex every token**: `/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g` over the shared-string text.
5. **Return a token inventory** to the portal:
   ```
   {
     tokens: [
       { token: "{{poNumber}}", row: 4,  col: "C", occurrences: 1 },
       { token: "{{sn}}",       row: 12, col: "A", occurrences: 1 },
       { token: "{{b_od}}",     row: 12, col: "D", occurrences: 1 },
       ...
     ],
     candidateRegionRows: [12],   // rows carrying >1 token — likely the repeating region
     sheetName, sheetDimensions
   }
   ```

### Header-scope vs. item-scope (repeating region) — DECLARED, with a heuristic assist

The engine's model of "repeating region" is a **single marker token whose worksheet row is
cloned once per serial** ([`xlsx-token-engine.ts:198-215`](../../api/src/app/export/mappings/xlsx-token-engine.ts),
`firstRegion` in [`export-engine.ts:183-189`](../../api/src/app/export/mappings/xlsx-token-engine.ts)).
So "item scope" is definitionally *"the tokens that share the marker row."*

**Design: ops declares the region; the extractor pre-fills a heuristic guess.**

- The extractor flags `candidateRegionRows` = rows that carry multiple tokens (the marker
  row of a real template has many: `{{sn}}`, `{{b_od}}`, … all on one line). This is a
  reliable heuristic because header tokens are scattered one-per-cell across the top matter,
  while item tokens cluster on the single repeating row.
- In the authoring UI, ops confirms **which row is the repeating region** (or picks "no
  repeating region — flat report"). Every token on that row → `scope: "item"`,
  `region: "<regionId>"`. Every token off that row → `scope: "header"`.
- Ops also picks the **marker token** (default: the first token on the region row, which for
  drill pipe is `{{sn}}` = the serial). The marker must be a token whose *row* is the clone
  template — it becomes `regions[0].marker`.

**We do not auto-detect scope purely from geometry** because FR/EN templates and 36 tool
types will not follow one layout convention. Geometry *proposes*; ops *confirms*. This keeps
the extractor template-agnostic (no drill-pipe assumptions baked in — the requirement).

### What the extractor returns vs. what ops must add

The workbook gives us **token names and positions only**. It does **not** encode:
`label`, `type`, `required`, `options`, or the `field` *key* the token binds to. Those are
authored by ops in-app (§4). So the extractor's job ends at "here are the tokens and where
they sit"; the authoring UI turns each token into a `field` + `export` entry.

### Structural dependencies

- **Reuses verbatim** (read-only): `parseSharedStrings`, `getSharedStringIndicesForRow`,
  `rowRegex` pattern — all exported from
  [`xlsx-token-engine.ts`](../../api/src/app/export/mappings/xlsx-token-engine.ts). No new
  OOXML parser.
- **Depends on** `JSZip` + `ExcelJS` (both already api-side).
- **Cross-app:** extractor output is a *new* HTTP contract (no shared DTO package — ADR-0008),
  so the token-inventory type is duplicated portal-side by hand.

---

## 3. `.xls` → `.xlsx` at the door — SheetJS as a pre-normalizer

### Why it's needed

ExcelJS reads **`.xlsx`/`.xlsm`/CSV only** — it cannot parse the legacy BIFF (`.xls`) binary
format. `TemplateValidationService` today hard-rejects anything not ending in `.xlsx`
([`template-validation.service.ts:19-24`](../../api/src/app/template/template-validation.service.ts)).
Phase D must *accept* `.xls` (ops has legacy templates) and normalize it before anything else
touches it.

### Where SheetJS slots in

A **single conversion step at the very front of `POST /templates`**, before validation,
hashing, or storage:

```
upload buffer
  │
  ├─ if .xls → SheetJS: read(buffer) → write({type:'buffer', bookType:'xlsx'}) → xlsx buffer
  │                     (legacy BIFF → OOXML, once, at the door)
  ├─ if .xlsx → passthrough
  ▼
normalized .xlsx buffer  ──►  ExcelJS validation  ──►  sha256 hash  ──►  fileBlob (stored)
```

**Critical design point: convert once, store the converted `.xlsx`.** The `fileBlob` and its
`hash` are stored *post-conversion*. Everything downstream — the hash drift check at export
([`export.service.ts:274`](../../api/src/app/export/export.service.ts)), token extraction (§2),
the export engine's OOXML surgery — then operates on a single uniform `.xlsx` representation.
We never store `.xls` bytes and never run SheetJS again after upload.

### How SheetJS and ExcelJS coexist (no conflict)

They occupy **disjoint stages** and never touch the same buffer at the same time:

- **SheetJS (`xlsx`)** — *ingest normalizer only*. Reads legacy `.xls`, emits `.xlsx` bytes.
  Runs exactly once per upload. Never used for token substitution, export, or extraction.
- **ExcelJS** — *validation + export*. Only ever sees normalized `.xlsx`. Unchanged role.

They share no state and no file. SheetJS is a pure `bytes → bytes` transform at the boundary.

### Fidelity caveat (Fork D-2)

SheetJS `.xls`→`.xlsx` conversion is **lossy for exotic formatting** (some legacy styles,
macros, unusual merged-cell/print constructs). Since the converted `.xlsx` becomes the
export template, any conversion artifact ships in exported reports. **Decision needed:**
require ops to visually confirm a converted preview, or accept best-effort? (See §7.)

### Structural dependencies

- **New dependency:** `xlsx` (SheetJS) added to the **root** `package.json` (api-side,
  hoisted — same as ExcelJS). Portal does **not** get it (conversion is server-side).
- **Modifies:** the front of `POST /templates` handler / `createTemplate` (one pre-step).
- **Modifies:** `TemplateValidationService` — the `.xlsx`-only extension gate must move to
  *after* conversion, or accept `.xls` and delegate to the converter. The MIME allow-list
  ([`template-validation.service.ts:9-14`](../../api/src/app/template/template-validation.service.ts))
  gains the legacy `.xls` MIME (`application/vnd.ms-excel`) at the ingest edge.

---

## 4. The general definition shape — mapping today's structure + resolving each gap

### Current `definitionJson` structure (from [`drill-pipe-v1.definition.json`](../../api/src/app/template/definitions/drill-pipe-v1.definition.json) + engine readers)

```
{
  formatVersion, templateKey, templateVersion, displayName,
  sections:    [{ key, title }],                          // form grouping + order (portal)
  transforms:  { <name>: { kind, ...params } },           // export value transforms
  regions:     [{ id, label, marker, chunkSize }],        // repeating region(s)
  disposition: { enum, source[], syncedFrom, requiredForApproval },  // gate
  fields:      [{ key, label, type, required, scope,      // form + gate
                  region?, section?, options? }],
  export: { global: [ExportEntry], regions: { <id>: [ExportEntry] } },  // export
  rules:       [ { id, scope, when, then } ]              // rework
}
```

Each top-level key feeds a specific consumer (see §0 table). An ops-authored definition for
a non-drill-pipe tool must produce **all** of these — the authoring UI's job is to elicit
enough from ops (per token) to synthesize them. Most are mechanical once each token has
`{key, label, type, required, scope, section, options}` + a token↔field binding:

- `fields[]` ← one per described token.
- `sections[]` ← the distinct `section` values ops assigns (+ titles).
- `export.global` / `export.regions[regionId]` ← one entry per token: header tokens → global,
  item tokens → region, binding `token` ↔ `field`.
- `regions[]` ← the single declared region (§2).
- `disposition` ← ops names which field is the disposition (or "none").
- `transforms` / `rules` ← **the hard part** (see gaps below).

### Gap (a) — `type: 'date'` is in the token vocab but NOT in portal `FieldInputType`

**Confirmed concrete failure.** `FieldInputType = 'text' | 'number' | 'boolean' | 'select'`
([`drill-pipe-v1.schema.ts:1`](../../portal/src/app/features/templates/schemas/drill-pipe-v1.schema.ts)).
The form HTML only branches on `text|number`, `boolean`, `select`
([`serial-inspection-reactive-form.component.html`](../../portal/src/app/features/inspections/components/serial-inspection-reactive-form/serial-inspection-reactive-form.component.html) —
`@if (field.inputType === 'text' || 'number')`, `=== 'boolean'`, `=== 'select'`). And
`definitionToFormSchema` **casts** `f.type as FieldInputType` without validating
([`definition-to-form-schema.ts:62`](../../portal/src/app/features/templates/schemas/definition-to-form-schema.ts)).
So a `type: 'date'` field flows through to `inputType: 'date'`, matches **none** of the
`@if` branches, and renders as a **label with no input control → a silently blanked field.**

> The prompt is right: *the upload UI cannot offer a type the form cannot render.*

**Design — render `date` for real (recommended):** add `'date'` to `FieldInputType`, add a
fourth branch to the form template (`<input type="date">`), and let
`definitionToFormSchema` pass it through legitimately. `date` is a genuine ops need (36 tool
types, inspection/expiry dates). This is a small, contained portal change and it *unblocks*
offering `date` in the authoring UI. **Alternative (Fork D-3):** disallow `date` at authoring
time and force ops to use `text`. Cheaper but pushes date-format burden onto ops and loses
validation. Recommendation: implement `date` properly — the authoring UI must not offer a
type the form can't render, and the cleaner fix is to make the form render it.

### Gap (b) — real list primitive vs. the arrays-as-text + join hack

Today `equipmentUsed` / `inspectionMethod` are declared `type: 'text'` **item… no —
header** fields, but the *export* applies `objectListJoin` / `stringListJoin` transforms that
expect **arrays** ([`export-engine.ts:97-120`](../../api/src/app/export/export-engine.ts);
tokens `{{equipment}}`/`{{methods}}` in the definition's `export.global`). The form stores a
scalar; the data happens to be an array at export time. There is **no `list` input type** —
it's a text field whose value is *hoped* to be a list, joined at export. This is the "hack".

**Design options:**

- **D-4a (recommended for v1): don't expose lists in the authoring UI at all.** The two list
  fields are drill-pipe-specific and ride bespoke transforms. A *generic* non-drill-pipe
  template's first cut should offer only scalar types (`text/number/boolean/select/date`).
  Ops-authored lists are out of scope for the first ops template. This keeps the transform
  vocabulary closed (see gap c) and avoids inventing a list widget + a list-join transform
  authoring flow simultaneously.
- **D-4b (later): a real `list` primitive** — a repeating scalar input in the form, stored as
  a genuine array, exported via a *whitelisted* `stringListJoin`. Requires new form widget +
  offline serialization + a transform the ops UI can attach. Defer.

**Assumption stated:** the first real non-drill-pipe target does **not** need ops-authored
list fields. If it does, that's a blocking scope change (Fork D-4).

### Gap (c) — computed fields are an engine-side allow-list

The `COMPUTED` registry is a **hardcoded map of exactly five resolvers**
([`export-engine.ts:54-60`](../../api/src/app/export/export-engine.ts)):
`customerName`, `reportNumber`, `reportDate`, `inspectedBy`, `approvedBy`. A `computed:` name
not in this map resolves via optional chaining to `undefined` → falls to `whenEmpty`
(silent, no crash). So ops can *only* usefully reference these five.

**Design: the authoring UI constrains ops to the implemented set via a fixed dropdown.** When
ops marks a token as "system-computed", the UI offers **only** the five registry names
(sourced from a shared constant mirrored portal-side — no shared DTO package, so duplicated
and pinned by a test-oracle that asserts the portal list equals the `COMPUTED` keys). Ops
cannot type a free-form computed name. This makes the allow-list a *product constraint at
authoring time*, not a runtime surprise. New computed names remain a developer task (extend
the registry + the mirrored constant) — that's acceptable; computed values are inherently
code.

### Gap (d) — multi-region: is one repeating region enough?

**The engine supports exactly ONE region today.** `firstRegion(def)` reads `def.regions[0]`
and *every* export path — `engineRowTokenKeys`, `engineRowTokens`, `engineMap` — uses only
that first region ([`export-engine.ts:183-230`](../../api/src/app/export/export-engine.ts)).
`expandRegionAndSubstitute` clones exactly one marker row. Multi-region is **not
implemented**.

**Assumption stated (Fork D-5):** the first non-drill-pipe target uses **one repeating
region** (a single per-serial table, like drill pipe). The authoring UI offers exactly one
region + one flat header block, matching the engine's actual capability. If a real early
template needs 2+ repeating tables (e.g. two independent measurement grids), that is a
**substantial engine change** (multi-region loop, multi-marker detection, chunking per
region) and must be scoped separately — **do not** let the authoring UI offer what the engine
can't expand.

### Net: what an ops definition needs that the strict engine doesn't handle yet

| Need | Engine status | Phase D resolution |
|---|---|---|
| `date` input | Form can't render it (blanks) | Add `date` to `FieldInputType` + form branch (gap a) |
| List fields | Bespoke transforms, array-as-text | Exclude from v1 authoring (gap b, D-4a) |
| Arbitrary computed | 5-name hardcoded allow-list | Constrain UI to the 5 (gap c) |
| ≥2 repeating regions | Single-region only | Exclude from v1; one region (gap d) |
| Arbitrary transforms | `Unknown transform` throws | Constrain UI to whitelisted transform kinds (§5) |

---

## 5. Untrusted-definition validation — write-time gate + read-time tolerance

The engine is **fail-loud** because every definition today is the trusted backfill artifact.
An ops-authored definition can be *arbitrarily wrong*, and a wrong definition reaching a
consumer can **crash export mid-run** or **blank an inspector's form**. Two lines of defense.

### 5a. Write-time validation (the `PUT /templates/:id/definition` choke point)

**The definition is rejected before it can be written unless it is provably engine-safe.** A
new validator (server-side, the single hardening point) enforces:

1. **Structural completeness** — every top-level key present and correctly typed
   (`fields[]`, `sections[]`, `regions[]` non-empty, `export.global`, `export.regions`,
   `transforms`, `disposition`, `rules`).
2. **Closed type vocabulary** — every `field.type` ∈ `{text, number, boolean, select, date}`
   (the *renderable* set — see gap a). `select` requires non-empty `options`.
3. **Closed transform vocabulary** — every `transform` referenced in `export.*` exists in
   `transforms`, and every `transforms[].kind` ∈ the engine's implemented kinds
   (`booleanMap`, `rangeCompose`, `objectListJoin`, `stringListJoin`) — mirror of the
   `applyTransform` switch ([`export-engine.ts:85-123`](../../api/src/app/export/export-engine.ts)).
   Since v1 excludes list fields (gap b), the offered set is even narrower.
4. **Closed computed vocabulary** — every `computed` ∈ the 5 `COMPUTED` keys (gap c).
5. **Region integrity** — exactly one region; its `marker` is a real token present on a
   worksheet row of the *stored `fileBlob`* (cross-check against §2 extraction — the
   definition can only bind tokens the workbook actually contains). Every `export.regions`
   entry's `token` exists in the workbook; every item field's `region` matches the region id.
6. **Binding integrity** — every `export` entry's `field`/`compose`/`coalesce` path
   references a declared `fields[].key`; every item field has a `section` that exists in
   `sections[]`.
7. **Round-trip smoke test (the strongest check):** run the **actual engine** against the
   candidate definition + the stored workbook + a synthetic one-serial snapshot,
   server-side, in a try/catch. If `engineMap` / `engineGlobalTokens` / `engineRowTokens`
   throw, **reject the definition**. This proves export won't crash *before* the definition
   is ever stored — the engine itself is the oracle. Do the same dry-run against `engineGate`
   and `definitionToFormSchema` (run the portal transform server-side or mirror it) so a
   definition that would blank the form is rejected at write time.

Only a definition passing all seven is written. This converts every consumer's *runtime
crash* into an *authoring-time rejection with a specific message ops can act on.*

### 5b. Read-time tolerance (defense in depth — the engine must not crash on a bad row)

Write-time validation is the primary defense, but the consumers should still degrade
gracefully if a bad definition ever slips through (e.g. a hand-edited DB row, a future
migration bug):

- **Portal form fallback is currently a HAZARD for non-drill-pipe.** Today, a malformed
  definition makes `definitionToFormSchema` throw and the form **falls back to
  `DRILL_PIPE_V1_SCHEMA`** ([`report-validation.service.ts:142-146`](../../portal/src/app/core/validation/services/report-validation.service.ts),
  and the same catch in the form component). For a *pump* or *elevator* report, silently
  rendering the *drill-pipe* form is **worse than an error** — the inspector fills the wrong
  fields. **Design: replace the drill-pipe fallback with an explicit "this template's form
  could not be loaded — contact an admin" empty-state** for reports whose `templateKey ≠
  DRILL_PIPE_REPORT`. Never render one tool's form for another tool's report. (Fork D-6:
  keep drill-pipe fallback only for `DRILL_PIPE_REPORT`, hard-error empty-state otherwise.)
- **Export / gate / rework** keep their existing `null`→`PreconditionFailed`/`412` behavior
  for a *missing* definition, but should treat a *malformed present* definition the same way
  (precondition failure with a clear message) rather than a raw 500. This is a small
  hardening of the existing null-arms.

### What's validated where (summary)

| Check | Write-time (PUT) | Read-time (consumers) |
|---|---|---|
| Structural completeness | **Reject** | Treat malformed as precondition-failed, not 500 |
| Type/transform/computed vocab | **Reject** | (engine already throws on unknown transform — now unreachable) |
| Marker/token exists in workbook | **Reject** | n/a |
| Engine dry-run passes | **Reject** | n/a |
| Wrong-template form fallback | n/a | **Explicit empty-state, never drill-pipe form** |

### Structural dependencies

- **New:** a server-side definition validator. Strongest form **imports and runs the real
  engine** (`export-engine.ts`, `approval-gate.ts`) as its oracle — no duplicated validation
  logic, so it can't drift from what the engine actually accepts.
- **Modifies (portal):** the two fallback catches (`serial-inspection-reactive-form`,
  `report-validation.service`) to gate the drill-pipe fallback on `templateKey`.
- **Test-oracle:** the transform/computed/type allow-lists get a test asserting the
  portal-mirrored constants equal the engine's actual switch/registry keys (guards the
  no-shared-DTO duplication).

---

## 6. Delivery path — CONFIRMED, zero new plumbing

A written `definitionJson` reaches every consumer by the **same route the engine already
uses.** Traced end to end:

- **Server-side consumers (export, gate, rework)** read the `Template` row **directly** by
  `tenantId_templateKey_templateVersion` at the moment they run
  ([`export.service.ts:258`](../../api/src/app/export/export.service.ts),
  [`inspection-report-workflow.service.ts:313`](../../api/src/app/workflow/inspection-report-workflow.service.ts),
  [`child-reports.service.ts:48`](../../api/src/app/child-reports/child-reports.service.ts)).
  Once the column is written, they pick it up on the next call. **Nothing to wire.**
- **Portal consumers (form, readiness validation)** receive it embedded in the report list
  payload: [`inspection-reports.service.ts:67-92`](../../api/src/app/inspection-reports/inspection-reports.service.ts)
  joins `Template.definitionJson` onto each report by `templateKey@templateVersion` and ships
  it as `report.definitionJson`. The offline layer hydrates it into
  `LocalInspectionReport.definitionJson` (IndexedDB), and the form
  ([`serial-inspection-reactive-form.component.ts:56`](../../portal/src/app/features/inspections/components/serial-inspection-reactive-form/serial-inspection-reactive-form.component.ts))
  + validation read it. **This is the exact path the backfilled drill-pipe definition already
  flows through** — the same code that today carries `null` will carry the ops-authored
  object with no change.

**Nothing is missing.** The only precondition is timing: a report pins `templateKey` +
`templateVersion` at creation; it will only carry a definition if the pinned template row
*has one written*. Which surfaces the one real gap → **Fork D-1** (what happens to reports
created against an uploaded-but-undefined template).

---

## Proposed build order (smallest provable steps)

Each step is independently testable and leaves the system working (drill-pipe unaffected).

1. **`date` input type (portal).** Add `'date'` to `FieldInputType`, add the form template
   branch, pass-through in `definitionToFormSchema`. *Provable:* a definition with a `date`
   field renders a working date input; drill-pipe unchanged (it has no date fields). Smallest,
   unblocks the authoring UI's type list.
2. **SheetJS ingest normalizer (api).** Add `xlsx` dep; convert `.xls`→`.xlsx` at the front
   of `POST /templates`; store converted bytes + hash. *Provable:* upload a legacy `.xls`,
   assert stored `fileBlob` is valid `.xlsx` and re-parses under ExcelJS; `.xlsx` upload
   byte-unchanged.
3. **Token extractor + `GET /templates/:id/tokens` (api).** Reuse the OOXML machinery to
   return the token inventory. *Provable:* against the real drill-pipe template, assert the
   extractor finds exactly its known tokens with correct rows; region-row heuristic flags the
   `{{sn}}` row.
4. **Definition validator + engine dry-run (api).** The §5a seven checks, using the real
   engine as oracle. *Provable:* the existing `drill-pipe-v1.definition.json` passes; a battery
   of deliberately-broken definitions each reject with the right message.
5. **`PUT /templates/:id/definition` (api).** Guarded write (optimistic concurrency) behind
   the validator, with audit log. *Provable:* write a hand-built pump definition to a test
   template, read it back, assert the engine exports/gates it without throwing.
6. **Portal fallback hardening (§5b).** Gate the drill-pipe fallback on
   `templateKey === DRILL_PIPE_REPORT`; explicit empty-state otherwise. *Provable:* a report
   with a malformed non-drill-pipe definition shows the empty-state, never the drill-pipe form.
7. **Authoring UI (portal).** New route/component: extract → describe each token
   (label/type/required/options/scope/section, region + marker pick, computed dropdown) →
   submit. Wire `AdminTemplatesService.getTokens` / `saveDefinition`. *Provable:* end-to-end
   with a real non-drill-pipe workbook, a genuinely non-drill-pipe report renders + exports.
8. **End-to-end acceptance:** upload a real FR/EN non-drill-pipe `.xls`, author it, create a
   report against it, fill the form offline, sync, export — with **no developer edit and no
   drill-pipe assumption anywhere in the path.**

Drill pipe remains the frozen oracle throughout: every step must leave
`DRILL_PIPE_V1_SCHEMA` / `drill-pipe-v1.definition.json` behavior byte-identical.

---

## Product / behavior forks needing your decision before building

- **D-1 — Uploaded-but-undefined template.** A row can exist with `definitionJson = NULL`
  (uploaded, not yet authored). Today NULL = server misconfiguration (rework/export throw
  `PreconditionFailed`). **Decide:** should report creation be *blocked* against a template
  with no definition (recommended — a "DRAFT" template status until defined), or allowed
  (and reports created in the gap carry NULL forever)? This drives whether we add a template
  lifecycle state (`DRAFT → ACTIVE`).
- **D-2 — `.xls` conversion fidelity.** SheetJS `.xls`→`.xlsx` is lossy for exotic
  formatting, and the converted `.xlsx` is what exports ship. **Decide:** require ops to
  confirm a rendered preview of the converted workbook before it's stored, or accept
  best-effort silently?
- **D-3 — `date` handling.** Recommended: render `date` for real (build step 1). **Decide:**
  confirm, or instead forbid `date` in authoring and force `text` (cheaper, worse data)?
- **D-4 — List fields.** Recommended: exclude ops-authored lists from v1 (scalars only).
  **Decide:** confirm the first non-drill-pipe target needs no list field — or, if it does,
  this is a scope expansion (list widget + whitelisted list-join transform + offline array
  serialization).
- **D-5 — Multi-region.** Recommended assumption: one repeating region (engine's actual
  capability). **Decide:** confirm the first target is single-region — or, if it needs 2+
  repeating tables, schedule the engine multi-region work *first* (it's a prerequisite, not a
  UI toggle).
- **D-6 — Wrong-template fallback.** Recommended: never render the drill-pipe form for a
  non-drill-pipe report; show an explicit empty-state on malformed/missing definition.
  **Decide:** confirm — this changes today's silent drill-pipe fallback behavior.
- **D-7 — Code placement.** New authoring logic on `TemplateService`/`TemplateController`, or
  a dedicated `TemplateDefinitionService` + module alongside it? (Leaning: dedicated service
  to keep the audited byte-path class small and the untrusted-input boundary isolated.)
- **D-8 — Bilingual (FR/EN).** Field `label` is a single string today. **Decide:** does an
  ops definition need per-locale labels (`label: { en, fr }`) — a shape change to `fields[]`
  and the form — or is one label-per-field (ops picks the language) sufficient for v1? This
  wasn't in the enumerated gaps but the FR/EN requirement implies it; flagging for a decision.
