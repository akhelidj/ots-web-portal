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
 *   - No transforms and no rework `rules` are authored by ops in this step — the
 *     builder emits `transforms: {}` and `rules: []`. Booleans/dates export as raw
 *     values, not drill-pipe's `"X"`/`"1"` formatting. See the builder for the exact
 *     equivalence boundary vs. the hand-authored drill-pipe definition.
 */

/** Portal-renderable field types. `date` is now allowed (form renders it). No `list`. */
export type OpsFieldType = 'text' | 'number' | 'boolean' | 'select' | 'date';

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
    id: string;
    label?: string;
    /** The token whose row repeats per serial, e.g. `"{{sn}}"`. Must exist in the sheet. */
    marker: string;
    chunkSize?: number | null;
  };
  /** Optional disposition designation — names an item field key used as the gate's source. */
  disposition?: {
    /** An item field key (token-derived, e.g. `"emi"`). */
    field: string;
    requiredForApproval: boolean;
  };
  fields: OpsTokenField[];
  computed?: OpsComputedToken[];
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
  regions: { id: string; label: string; marker: string; chunkSize: number | null }[];
  disposition?: { source: string[]; requiredForApproval: boolean };
  fields: {
    key: string;
    label: string;
    type: OpsFieldType;
    required: boolean;
    scope: 'header' | 'item';
    region?: string;
    section?: string;
    options?: string[];
  }[];
  export: {
    global: CandidateExportEntry[];
    regions: Record<string, CandidateExportEntry[]>;
  };
  rules: unknown[];
}
