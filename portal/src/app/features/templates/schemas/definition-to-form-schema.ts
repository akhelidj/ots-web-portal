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

export interface TemplateFormDefinition {
  templateKey: string;
  templateVersion: number;
  sections?: DefinitionSection[];
  fields: DefinitionField[];
}

/**
 * Adapt a template definition into the FormSchema the reactive form already
 * consumes. Proven to reproduce DRILL_PIPE_V1_SCHEMA exactly for drill pipe
 * (definition-to-form-schema.spec.ts), so the component's downstream form-build
 * code is reused verbatim behind the fallback switch.
 *
 *   - only item-scope fields become form fields (header fields live elsewhere);
 *   - fields group by `section`, sections ordered by the definition's `sections`;
 *   - within a section, fields keep definition array order (which, for drill pipe,
 *     matches the schema — e.g. box.hardBanding stays last in the Box section);
 *   - type → inputType, required → required, options carried only when present.
 */
export function definitionToFormSchema(
  definition: TemplateFormDefinition,
): FormSchema {
  const itemFields = definition.fields.filter((f) => f.scope === 'item');

  const bySection = new Map<string, FieldSchema[]>();
  for (const f of itemFields) {
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

  const sections: SectionSchema[] = orderedSectionKeys
    .filter((key) => bySection.has(key))
    .map((key) => ({
      key,
      title: titleByKey.get(key) ?? key,
      fields: bySection.get(key) ?? [],
    }));

  return {
    templateKey: definition.templateKey,
    templateVersion: definition.templateVersion,
    sections,
  };
}
