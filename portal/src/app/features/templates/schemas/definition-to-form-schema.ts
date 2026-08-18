import {
  FormSchema,
  FieldSchema,
  SectionSchema,
  FieldInputType,
} from './drill-pipe-v1.schema';

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
}

/**
 * Adapt a template definition into the FormSchema the reactive form already
 * consumes. Proven to reproduce DRILL_PIPE_V1_SCHEMA exactly for drill pipe
 * (definition-to-form-schema.spec.ts), so the component's downstream form-build
 * code is reused verbatim behind the fallback switch.
 *
 * MODE SWITCH (explicit discriminator — `regions.length`, never emptiness inference):
 *   - REGION template (`regions.length === 1`, e.g. drill pipe): only item-scope
 *     fields become form fields (header fields live elsewhere — report metadata).
 *     UNCHANGED from the original behavior; the drill-pipe golden pins it.
 *   - FLAT template (`regions.length === 0`): there is no "elsewhere" — the whole
 *     definition IS one record's form, so EVERY field (header + item scope) renders.
 *     A flat template that filtered to item-scope would drop its header fields and
 *     render a blank form; the explicit flat branch is what prevents that.
 *   - Absent/oldshape `regions` → treated as a region template (conservative default;
 *     never flips a legacy definition into the flat, render-everything path).
 *
 * In both modes: fields group by `section` (sections ordered by the definition's
 * `sections`); within a section fields keep definition array order; type → inputType,
 * required → required, options carried only when present. For flat templates, any
 * field whose `section` is not among the declared `sections` (e.g. a section-less
 * header field) is emitted in a trailing group so no flat field is silently dropped.
 */
export function definitionToFormSchema(
  definition: TemplateFormDefinition,
): FormSchema {
  const isFlat =
    Array.isArray(definition.regions) && definition.regions.length === 0;

  // Region: item-scope only (today's behavior). Flat: all fields ARE the form.
  const formFields = isFlat
    ? definition.fields
    : definition.fields.filter((f) => f.scope === 'item');

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
    fields.push(field);
    bySection.set(sectionKey, fields);
  }

  const orderedSectionKeys = (definition.sections ?? []).map((s) => s.key);
  const titleByKey = new Map(
    (definition.sections ?? []).map((s) => [s.key, s.title]),
  );

  // Declared sections that actually have fields — the ONLY groups a region template
  // ever emits (drill-pipe item fields are all sectioned), so the region path is
  // byte-identical to before. For a flat template, append any leftover groups
  // (fields whose section wasn't declared, e.g. section-less header fields) after the
  // declared ones, in first-seen order — so header fields still render.
  const declaredKeys = orderedSectionKeys.filter((key) => bySection.has(key));
  const leftoverKeys = isFlat
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
