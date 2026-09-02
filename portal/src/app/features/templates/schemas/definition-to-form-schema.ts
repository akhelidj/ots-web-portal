import {
  FormSchema,
  FieldSchema,
  SectionSchema,
  FieldInputType,
  FieldRole,
} from './drill-pipe-v1.schema';

/**
 * A resolved value for a system-owned (roled) header field, derived once in the detail
 * component and passed down to the read-only header surfaces. `value` is display-ready;
 * when `pending` (not inspected/approved yet) the surfaces show `pendingLabel` instead of
 * a blank/error, and `source` is the one-line explanation of where the value comes from.
 */
export interface SystemRoleValue {
  value: string;
  pending: boolean;
  pendingLabel: string;
  source: string;
}

/** Derived values for the roled header fields present in a definition, keyed by role. */
export type SystemRoleValues = Partial<Record<FieldRole, SystemRoleValue>>;

/**
 * Phase B3 — portal-side view of the (backend-authored) template definition, as
 * delivered embedded in the GET /inspection-reports payload
 * (Template.definitionJson). Only the slice the inspection FORM needs is typed
 * here: fields (item-scope), their section grouping, and section titles/order.
 * The definition also carries transforms/regions/export/rules that the form ignores.
 */
export interface DefinitionField {
  key: string;
  label: string;
  type: FieldInputType;
  required: boolean;
  scope: 'header' | 'item';
  region?: string;
  options?: string[];
  section?: string;
  /**
   * System role (header scope only) — mirrors the API. A roled field is system-owned and
   * NOT user-writable: the header-edit form builds no control for it, and both header
   * surfaces render a read-only "System" row showing the derived value.
   */
  role?: FieldRole;
}

export interface DefinitionSection {
  key: string;
  title: string;
}

/**
 * The repeating region, as carried in the backend definition. Only its PRESENCE
 * matters to the form adapter: `regions.length === 1` is a region (drill-pipe-shaped)
 * template, `regions.length === 0` is a FLAT (region-less) template. The adapter reads
 * only `.length` — this is the EXPLICIT flat/region discriminator (never inferred from
 * an empty field/section set). See phase-d-flat-templates-design.md §4.
 */
export interface DefinitionRegion {
  id: string;
  marker?: string;
}

export interface TemplateFormDefinition {
  templateKey: string;
  templateVersion: number;
  sections?: DefinitionSection[];
  /**
   * Present in the backend definitionJson. Drives the flat/region mode switch in
   * `definitionToFormSchema`. Optional/absent is treated as a region template (the
   * conservative default — never flips a legacy definition to the flat path).
   */
  regions?: DefinitionRegion[];
  fields: DefinitionField[];
  /**
   * Where a serial's disposition lives, mirrored from the backend definition and the
   * server approval gate. `source` is an ordered first-truthy coalesce of dotted paths
   * into a serial's inspection data (one path per real template — drill-pipe's is
   * `body.emiResult`). `requiredForApproval` gates whether an absent disposition blocks
   * approval. Absent block → the template has no disposition (nothing to read, not
   * required). Read it through `resolveDisposition` so every client surface — validation,
   * the detail KPIs/Findings, the list — resolves disposition identically to the gate.
   */
  disposition?: {
    source?: string[];
    requiredForApproval?: boolean;
  };
}

/** Dotted-path walk with the same falsy-node short-circuit as the server gate's `walk`. */
function walkPath(data: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, part) => (acc ? (acc as Record<string, unknown>)[part] : acc),
      data,
    );
}

/**
 * The ONE disposition resolver every portal surface shares — the client mirror of the
 * server's `resolveDisposition` (approval-gate.ts). Resolves a serial's disposition from
 * wherever the template definition declares (`disposition.source`, first-truthy coalesce),
 * never a hardcoded field. Returns `null` when nothing is declared or resolves; callers
 * decide what that means (a required-but-absent disposition is a blocker only when
 * `dispositionRequired` is true, matching the gate).
 */
export function resolveDisposition(
  data: unknown,
  definition: TemplateFormDefinition | null | undefined,
): string | null {
  const sources = definition?.disposition?.source ?? [];
  for (const path of sources) {
    const value = walkPath(data, path);
    if (value) return String(value);
  }
  return null;
}

/** Whether the template requires a disposition for approval — mirrors the server gate. */
export function dispositionRequired(
  definition: TemplateFormDefinition | null | undefined,
): boolean {
  return definition?.disposition?.requiredForApproval === true;
}

/** Which scope's fields the adapter emits. Absent → the default item/flat behavior. */
export interface DefinitionToFormSchemaOptions {
  /**
   * `'header'` → emit the HEADER-scope slice (the Specs tab). Absent/`'item'` → the
   * original item/flat behavior (the serial-drawer form), byte-identical to before.
   */
  scope?: 'item' | 'header';
}

/**
 * Adapt a template definition into the FormSchema the reactive form already consumes.
 * ONE adapter, scope-parameterized — the header slice folded in so item, flat, and
 * header modes share the identical grouping/label/option machinery (they differed only
 * in field selection and whether section-less leftovers are kept).
 *
 * Proven to reproduce DRILL_PIPE_V1_SCHEMA exactly for drill pipe
 * (definition-to-form-schema.spec.ts) and the flat golden (flat-form-schema.spec.ts) on
 * the default (no-options) call, so every existing single-arg caller is unchanged.
 *
 * FIELD SELECTION:
 *   - HEADER mode (`scope: 'header'`): the header-scope fields — the Specs tab.
 *   - FLAT template (`regions.length === 0`, explicit discriminator, never emptiness
 *     inference): the whole definition IS one record's form, so EVERY field renders.
 *   - REGION template (default, e.g. drill pipe): item-scope fields only (header fields
 *     live elsewhere — report metadata). The drill-pipe golden pins this.
 *   - Absent/oldshape `regions` → region template (conservative default; never flips a
 *     legacy definition into the flat, render-everything path).
 *
 * In all modes: fields group by `section` (ordered by the definition's `sections`);
 * within a section fields keep definition array order; type → inputType, required →
 * required, options carried only when present.
 *
 * LEFTOVER (section-less / undeclared) groups are appended — after the declared ones, in
 * first-seen order — only where they must NOT be dropped: HEADER mode (header fields are
 * section-less) and FLAT mode (a section-less field in a flat template). The region
 * default drops them, staying byte-identical to the drill-pipe golden (whose item fields
 * are all sectioned).
 */
export function definitionToFormSchema(
  definition: TemplateFormDefinition,
  options: DefinitionToFormSchemaOptions = {},
): FormSchema {
  const headerMode = options.scope === 'header';
  const isFlat =
    !headerMode &&
    Array.isArray(definition.regions) &&
    definition.regions.length === 0;

  const formFields = (
    headerMode
      ? definition.fields.filter((f) => f.scope === 'header')
      : isFlat
        ? definition.fields
        : definition.fields.filter((f) => f.scope === 'item')
  )
    // The `serialNumber`-roled field marks the serial's own token (the region marker), not
    // a describable value — it is the row's identity, never an input. Filter it out of
    // every form slice so it can't render as an editable serial field. Header/flat slices
    // can't reach it (it is item-scope), but the filter keeps the guarantee explicit and
    // total. Role-less definitions (incl. drill pipe) are unaffected — golden unchanged.
    .filter((f) => f.role !== 'serialNumber');

  const bySection = new Map<string, FieldSchema[]>();
  for (const f of formFields) {
    const sectionKey = f.section ?? '';
    const fields = bySection.get(sectionKey) ?? [];
    const field: FieldSchema = {
      key: f.key,
      label: f.label,
      inputType: f.type as FieldInputType,
      required: f.required,
    };
    if (f.options) {
      field.options = f.options;
    }
    // Carried only when present, mirroring `options` — so a role-less definition (every
    // existing template, incl. drill pipe) produces the byte-identical golden schema.
    if (f.role) {
      field.role = f.role;
    }
    fields.push(field);
    bySection.set(sectionKey, fields);
  }

  const orderedSectionKeys = (definition.sections ?? []).map((s) => s.key);
  const titleByKey = new Map(
    (definition.sections ?? []).map((s) => [s.key, s.title]),
  );

  const declaredKeys = orderedSectionKeys.filter((key) => bySection.has(key));
  const appendLeftovers = headerMode || isFlat;
  const leftoverKeys = appendLeftovers
    ? [...bySection.keys()].filter((key) => !orderedSectionKeys.includes(key))
    : [];

  const sections: SectionSchema[] = [...declaredKeys, ...leftoverKeys].map(
    (key) => ({
      key,
      title: titleByKey.get(key) ?? key,
      fields: bySection.get(key) ?? [],
    }),
  );

  return {
    templateKey: definition.templateKey,
    templateVersion: definition.templateVersion,
    sections,
  };
}
