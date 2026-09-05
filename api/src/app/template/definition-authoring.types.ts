import { OutcomeMapping } from '../workflow/approval-gate';

/** Re-exported so template-layer consumers get the outcome-mapping shape from one place. */
export type { OutcomeMapping };

/**
 * Phase D step 2a — the ops-authored template description accepted by
 * `PUT /templates/:id/definition`, and the engine-shaped candidate definition it
 * maps to.
 *
 * SCOPE (deliberately narrow — this is the untrusted-input boundary):
 *   - English-only: `label` is a plain string.
 *   - Scalars + date only: no list types (rejected by validation, not representable
 *     here).
 *   - Exactly ONE repeating region (the engine reads only `regions[0]`).
 *   - No transforms authored by ops — the builder emits `transforms: {}`.
 *     Booleans/dates export as raw values, not drill-pipe's `"X"`/`"1"` formatting.
 *   - Rework: a single OPTIONAL `reworkRule` (slice A) — the one trigger shape the
 *     interpreter consumes. Absent → the builder emits `rules: []` (unchanged); present
 *     → one `upsertChildReport` rule. See the builder for the exact equivalence
 *     boundary vs. the hand-authored drill-pipe definition.
 */

/**
 * Portal-renderable field types. `date` renders as a date input; `object-list`
 * (Phase D step 2) is the generic array type — a repeated `{ name, number? }`
 * group rendered with a structured array editor and consumed by the export
 * transforms as an array. Any array field uses it (no field-name special-casing).
 */
export type OpsFieldType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'date'
  | 'object-list';

/**
 * A HEADER field's SYSTEM role. A roled header field is not user-writable: its value is
 * always DERIVED at export from the engine's existing computed tokens — inspector/
 * supervisor/inspectionDate from the transition log, customer/reportNumber/poNumber from
 * the report's creation-time metadata. Header scope only (the validator rejects one on an
 * item field); each role may appear at most once per definition.
 *
 * All six are now MANDATORY to SAVE a definition (the validator's presence check, mirrored
 * client-side) — a NEW/edited template must map every one to a token. They remain
 * structurally optional on the type so pre-mandate ("grandfathered") stored definitions
 * still LOAD and EXPORT: the presence check runs only at save, never on read/export.
 */
export type HeaderFieldRole =
  | 'inspector'
  | 'supervisor'
  | 'inspectionDate'
  | 'customer'
  | 'reportNumber'
  | 'poNumber';

/**
 * A field's SYSTEM role. Roles split by scope: the six HEADER roles above bind to a
 * computed token, and the single ITEM role `serialNumber` marks the serial's own token —
 * the one emitted as the region's `rowSerial` export entry (the API's `region.marker`).
 * `serialNumber` is item-scope only (the validator rejects it on a header field) and, like
 * every role, may appear at most once. All seven roles are mandatory to SAVE (see above and
 * the validator's presence check); they stay structurally optional for grandfathering.
 */
export type FieldRole = HeaderFieldRole | 'serialNumber';

/** Roles that must sit on an ITEM-scope field. `serialNumber` is the only one today. */
export const ITEM_ROLES: ReadonlySet<string> = new Set<FieldRole>(['serialNumber']);

/**
 * Maps a HEADER field role onto the engine's EXISTING computed token name (no new computed
 * names). The builder emits a roled header field's token as `{ computed }` instead of a
 * plain `{ field }` export entry, so its value comes from the transition-log derivation
 * that already backs `{{inspectedBy}}` / `{{approvedBy}}` / `{{reportDate}}`. The item role
 * `serialNumber` is NOT here — it binds to `rowSerial`, not a computed token.
 */
export const ROLE_TO_COMPUTED: Record<HeaderFieldRole, string> = {
  inspector: 'inspectedBy',
  supervisor: 'approvedBy',
  inspectionDate: 'reportDate',
  // Name reconciliation: the `customer` role resolves to the `customerName` computed.
  customer: 'customerName',
  reportNumber: 'reportNumber',
  poNumber: 'poNumber',
};

/** One ops-described field, keyed to a workbook token. */
export interface OpsTokenField {
  /** Token literal from the workbook, e.g. `"{{poNumber}}"`. Must exist in the sheet. */
  token: string;
  /** Plain-English label shown on the form. */
  label: string;
  type: OpsFieldType;
  required: boolean;
  /** Header-scope (report metadata) vs. item-scope (per-serial, in the region). */
  scope: 'header' | 'item';
  /**
   * Optional SYSTEM role. A HEADER role (inspector/supervisor/inspectionDate) makes the
   * field derived — its value comes from the transition-log-backed computed token, never
   * from user input. The ITEM role `serialNumber` marks the serial's own token (the
   * region's `rowSerial` / `region.marker`); it is excluded from the item form and the
   * per-serial export entries. See FieldRole.
   */
  role?: FieldRole;
  /** Form section grouping (item fields). */
  section?: string;
  /** Choices — required iff `type === 'select'`. */
  options?: string[];
}

/** A token bound to a system-computed value instead of a user field. */
export interface OpsComputedToken {
  token: string;
  /** Must be one of the engine's implemented computed names (COMPUTED_NAMES). */
  computed: string;
}

/** The full request body for `PUT /templates/:id/definition`. */
export interface DefineTemplateDto {
  displayName?: string;
  /**
   * The repeating region, or omitted for a FLAT template. Present → the report has
   * repeating serial rows (a marker whose row is cloned per serial). Omitted → a flat,
   * region-less template: one record, header/record fields at fixed cells, no repeating
   * rows. Zero or one region only (never more). See phase-d-flat-templates-design.md.
   */
  region?: {
    /**
     * DEPRECATED / IGNORED. The region id is now an internal constant assigned by the
     * builder — it is no longer an ops choice. Accepted for back-compat with older
     * clients but not read.
     */
    id?: string;
    label?: string;
    /**
     * The serial's OWN token, e.g. `"{{sn}}"` — the placeholder that resolves to each
     * serial number in the repeating row. Must exist in the sheet. It is emitted as the
     * region's `rowSerial` export entry. It is NOT a row locator: the repeating row is
     * inferred from the region's row tokens (this token among them). Formerly called the
     * "marker"; the name is kept for the wire contract.
     */
    marker: string;
    chunkSize?: number | null;
  };
  /** Optional disposition designation — names an item field key used as the gate's source. */
  disposition?: {
    /** An item field key (token-derived, e.g. `"emi"`). */
    field: string;
    requiredForApproval: boolean;
  };
  /**
   * Optional per-bucket OUTCOME mapping (pass/reject/actionRequired/hold). Names, per
   * bucket, an item field value-set that lands in it; a bucket omitting `token` reads the
   * disposition source. OPTIONAL and may be PARTIAL — unmapped values classify as `'other'`,
   * and an absent mapping makes every serial `'other'`. Passed straight through to the
   * stored definition (`OutcomeMapping` from the workflow layer).
   */
  outcomes?: OutcomeMapping;
  fields: OpsTokenField[];
  computed?: OpsComputedToken[];
  /**
   * Optional REWORK-style trigger rule (slice A). Authors ONLY the shape the
   * `ReworkRulesInterpreter` actually consumes: a single `when.field eq value`
   * predicate that upserts a child report over the matching serials. Absent → no
   * rule (the builder emits `rules: []`, the historical behaviour).
   *
   * `op` (`eq`), `action` (`upsertChildReport`) and `membership` (`allItemsMatching`)
   * each have exactly ONE interpreter-supported value, so they are NOT authored here —
   * the builder fills them. Fields the interpreter IGNORES (`id`, `scope`,
   * `then.forbidChildDisposition`) are deliberately not offered: exposing an
   * unread knob is the authored-but-unconsumed trap slice A avoids.
   */
  reworkRule?: OpsReworkRule;
}

/** The ops-authorable slice of an `upsertChildReport` rule (the supported shape only). */
export interface OpsReworkRule {
  /**
   * The field key (token-derived, e.g. `"emiResult"`) whose per-serial value triggers
   * the rule. Resolved against each serial's `inspectionData` by the interpreter; for a
   * describe-authored template this is the single-segment stripped-token key.
   */
  field: string;
  /** The value that field must strictly equal for a serial to match (`when.value`). */
  equals: string;
  /** The child report type to upsert — a `ChildReportType` (REWORK | SCRAP | HOLD). */
  childType: string;
  /** Optional suffix appended to the parent reportNumber when the child is created. */
  reportNumberSuffix?: string;
}

/** One resolved export entry (engine shape). */
export interface CandidateExportEntry {
  token: string;
  field?: string;
  computed?: string;
  source?: string;
  transform?: string;
  whenEmpty?: string;
}

/** The engine-shaped definition the builder produces and the validator/engine read. */
export interface CandidateDefinition {
  formatVersion: number;
  templateKey: string;
  templateVersion: number;
  displayName: string;
  sections: { key: string; title: string }[];
  transforms: Record<string, { kind: string; [k: string]: unknown }>;
  // No `marker`: the repeating row is inferred from the region's row tokens at export
  // time (xlsx-token-engine step 4). `id` is an internal constant keying `export.regions`.
  regions: { id: string; label: string; chunkSize: number | null }[];
  disposition?: { source: string[]; requiredForApproval: boolean };
  /** Per-bucket outcome mapping — the display/counting classifier's source of truth.
   *  Optional/partial; unmapped values classify as `'other'`. Stored verbatim. */
  outcomes?: OutcomeMapping;
  fields: {
    key: string;
    label: string;
    type: OpsFieldType;
    required: boolean;
    scope: 'header' | 'item';
    /** System role — header roles derive from a computed token; the item role
     *  `serialNumber` marks the serial's own token (not a rendered field). */
    role?: FieldRole;
    section?: string;
    options?: string[];
  }[];
  export: {
    global: CandidateExportEntry[];
    regions: Record<string, CandidateExportEntry[]>;
  };
  rules: unknown[];
}
