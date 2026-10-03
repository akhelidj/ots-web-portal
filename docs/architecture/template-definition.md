# Template Definition (`Template.definitionJson`)

A **template version** is an Excel workbook (`.xlsx`) with `{{tokens}}` plus a **definition** — a JSON document that says what each token is, how the inspection form is built, what gates approval, and how the export is filled. The definition is the single contract every consumer reads; nothing about a template is hardcoded in code any more. (The historical drill-pipe hardcodes were retired — see [ADR-0009](../adr/0009-single-template-hardcode-seam.md), [ADR-0010](../adr/0010-rework-rules-consumer.md).)

Versioning, storage and the admin validation gate are in [Template Versioning](template-versioning.md); endpoints in [`../api/template-endpoints.md`](../api/template-endpoints.md).

## Who reads the definition

| Consumer                         | Reads                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| Portal inspection form           | item-scope `fields` + `sections` → reactive form (`definition-to-form-schema.ts`)               |
| Portal header/specs, customer doc | header-scope `fields`                                                                           |
| `PENDING_APPROVAL` gate          | `disposition` + `required` flags (`engineGate`, `approval-gate.ts`)                             |
| Disposition column / snapshots / export sort | `disposition.source` through the one `resolveDisposition`                           |
| Export                           | `export`, `transforms`, `regions` (`export-engine.ts` + `xlsx-token-engine.ts`)                  |
| Rework child reports             | `rules` (`ReworkRulesInterpreter`)                                                              |
| Signatures                       | `signature` fields (who signs), the `inspectorSignature` header role                            |

"Usable" for a new report = `status == ACTIVE && definitionJson != null && approvalStatus == APPROVED`.

## Shape

```
{ formatVersion, templateKey, templateVersion, displayName,
  sections:   [{ key, title }],
  transforms: { name: { kind, ... } },        // booleanMap | rangeCompose | objectListJoin | stringListJoin
  regions:    [{ id, label, chunkSize }],      // zero (flat) or one repeating region
  disposition?: { source: [paths], requiredForApproval },
  fields:     [{ key, label, type, required, scope: 'header'|'item', role?, section?, options?, signer? }],
  export:     { global: [entry], regions: { <id>: [entry] } },
  rules:      [ upsertChildReport rule ... ] }
```

- **Field types:** `text`, `number`, `boolean`, `select`, `date`, `object-list` (repeated `{ name, number? }`), `signature` (header only; not an input — it marks where a picture lands and who signs: `CUSTOMER` or `SUPERVISOR`; `required` blocks export until signed).
- **Scope:** `header` = report-level values (stored in `InspectionReport.headerData`); `item` = per-serial values (stored in `SerialNumber.inspectionData`).
- **System roles:** header roles `inspector`, `supervisor`, `inspectionDate`, `customer`, `reportNumber`, `poNumber`, `inspectorSignature` are system-derived (never user-typed) and map to engine computed tokens; item role `serialNumber` marks the serial's own token. All eight are mandatory to **save** a new definition (grandfathered stored definitions still load and export).
- **Export entries** bind a token to a `field` path, a `computed` name (`customerName`, `reportNumber`, `poNumber`, `reportDate`, `inspectedBy`, `approvedBy`, `inspectorSignature`), a `const`, a `compose`/`coalesce`, a `transform`, a `whenEmpty` fallback, a `signature` slot, or `source: rowSerial | record`.
- **Region vs flat:** one repeating region → the row containing the region's tokens is cloned per serial and serials are chunked by `chunkSize` (null = never split). **No region = flat template** — one fixed-layout, header-only file, always exactly one output. More than one region is rejected.
- **Rules:** one optional `upsertChildReport` rule: `when.field == value` over serials creates/updates a child report of `childType` (`REWORK` | `SCRAP` | `HOLD`) with an optional report-number suffix. See [Rework Rules Consumer](rework-rules-consumer.md).
- **Statistics are not part of a definition.** The old outcome mapping was removed; statistics are typed per report ([ADR-0013](../adr/0013-free-entry-report-statistics.md)).

## Authoring flow

1. **Upload** the workbook (`POST /templates`): `.xlsx` only, must parse and contain a worksheet. New version of the key; stored through the storage abstraction by `fileKey` (see Template Versioning).
2. **Detect tokens** (`GET /templates/:id/tokens`): the workbook's `{{tokens}}` are extracted (tolerant of inner whitespace: `{{ x }}` = `{{x}}`; legacy `.xls` normalised at read time).
3. **Describe** (portal wizard, `PUT /templates/:id/definition`): _Detect Tokens → Metadata → Serial → Review & Save_. Ops assigns each token to header or item scope, labels it, picks type/required/options/section, assigns the mandatory system roles, optionally a disposition field, a rework rule and a display name. The wizard sends a plain description (`DefineTemplateDto`); the **builder** turns it into the engine-shaped `CandidateDefinition` (no transforms are ops-authored).
4. **Validate** (untrusted-input boundary, `definition-validator.ts`): structural checks (tokens exist in the sheet, renderable types, one-per-role, signer rules, region shape…) plus an **engine dry-run** — the candidate is fed through the very readers export and the gate use at runtime, so validation cannot drift from the engine. Any failure refuses the whole write (`400`).
5. **Write + history:** in one transaction the previous definition (if any) is appended to `TemplateDefinitionRevision` and `definitionJson` is overwritten. `GET /templates/:id/definition/revisions` and `POST .../revisions/:n/restore` expose it; a restore runs the same validation and is itself reversible.

In the portal a saved definition opens read-only; changing a form means defining a new version.

## Compatibility rules

- Never read the definition to bypass a role/serial check; it only describes data.
- A report is pinned to `(templateKey, templateVersion, templateHash)` at creation; later definition edits to other versions do not affect it, and exports of past revisions use the snapshot.
- A template with a `NULL` definition must never back a report; the portal falls back to the built-in `DRILL_PIPE_V1_SCHEMA` only for read/validation of legacy reports ("soft-NULL").
