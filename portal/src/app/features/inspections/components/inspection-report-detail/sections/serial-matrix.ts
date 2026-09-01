import { LocalSerialNumber } from '@portal/core/offline/models/types';
import { SectionSchema } from '@portal/features/templates/schemas/drill-pipe-v1.schema';

/**
 * Shared, definition-driven serial-matrix derivation.
 *
 * The ops serials table and the customer serials table render the SAME data
 * with different chrome, but the logic that turns a template definition + a
 * serial's `inspectionJson` into columns and cell text is identical. Keeping
 * two copies is the same lockstep hazard the duplicated `definitionToFormSchema`
 * call sites already carry — so the derivation lives here once and both tables
 * import it. Presentation (sticky headers, editing affordances, badges) stays in
 * each component's own template; only the extraction is shared.
 */

/**
 * One rendered matrix column, derived from a definition section's fields — never
 * hardcoded. A `range` column collapses an adjacent `<base>Min` / `<base>Max`
 * field pair into a single composed cell (schema-key driven, not a positional
 * special-case); every other field is its own `text` or `bool` column.
 */
export interface SerialTableColumn {
  id: string;
  label: string;
  kind: 'text' | 'bool' | 'range';
  /** Dotted field key for text/bool cells (e.g. `box.minOD`, `remarks`). */
  fieldKey: string;
  /** Range-pair keys (set only when kind === 'range'). */
  minKey?: string;
  maxKey?: string;
  /** Last column of its section → draw the group divider on its right edge. */
  isSectionEnd: boolean;
}

/** A definition section rendered as a colspan group band + its columns. */
export interface SerialTableColumnGroup {
  key: string;
  title: string;
  columns: SerialTableColumn[];
}

/**
 * Build the column-group model from a report's item-scope form sections (as
 * produced by `definitionToFormSchema`). Empty sections → no matrix columns.
 */
export function buildSerialColumnGroups(
  sections: SectionSchema[],
): SerialTableColumnGroup[] {
  const groups: SerialTableColumnGroup[] = [];

  for (const section of sections) {
    const columns: SerialTableColumn[] = [];
    const fields = section.fields;

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (!field) continue;

      const leaf = leafOf(field.key);
      // Adjacent `<base>Min` / `<base>Max` → one range column, consuming the Max.
      if (leaf.endsWith('Min')) {
        const base = leaf.slice(0, -3);
        const next = fields[i + 1];
        if (next && leafOf(next.key) === `${base}Max`) {
          columns.push({
            id: `${field.key}|${next.key}`,
            label: field.label.replace(/\s*Min$/i, ''),
            kind: 'range',
            fieldKey: field.key,
            minKey: field.key,
            maxKey: next.key,
            isSectionEnd: false,
          });
          i++;
          continue;
        }
      }

      columns.push({
        id: field.key,
        label: field.label,
        kind: field.inputType === 'boolean' ? 'bool' : 'text',
        fieldKey: field.key,
        isSectionEnd: false,
      });
    }

    const last = columns[columns.length - 1];
    if (last) {
      last.isSectionEnd = true;
      groups.push({ key: section.key, title: section.title, columns });
    }
  }

  return groups;
}

/**
 * Render one matrix cell, dispatching on the column kind derived from the schema
 * (declared type / range-pair keys) — never on a hardcoded position.
 */
export function getSerialCellText(
  sn: LocalSerialNumber,
  col: SerialTableColumn,
): string {
  switch (col.kind) {
    case 'range':
      return getRangeByKey(
        sn,
        col.minKey ?? col.fieldKey,
        col.maxKey ?? col.fieldKey,
      );
    case 'bool':
      return getBooleanLabelByKey(sn, col.fieldKey);
    default:
      return getFieldTextByKey(sn, col.fieldKey);
  }
}

/**
 * The serial's recorded disposition (`inspectionJson.body.emiResult`), or null
 * when none has been captured yet.
 */
export function getSerialDisposition(sn: LocalSerialNumber): string | null {
  if (!sn.inspectionJson) return null;
  const bodySection = sn.inspectionJson['body'] as
    | Record<string, unknown>
    | undefined;
  return (bodySection?.['emiResult'] as string) || null;
}

function leafOf(key: string): string {
  const idx = key.lastIndexOf('.');
  return idx === -1 ? key : key.slice(idx + 1);
}

/**
 * Nested lookup by dotted field key (`box.minOD`) or bare key (`remarks`),
 * matching how the drawer form stores values into `inspectionJson`.
 */
function valueByKey(sn: LocalSerialNumber, key: string): unknown {
  if (!sn.inspectionJson) return undefined;
  let current: unknown = sn.inspectionJson;
  for (const part of key.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
    if (current === undefined) return undefined;
  }
  return current;
}

function getFieldTextByKey(sn: LocalSerialNumber, key: string): string {
  const value = valueByKey(sn, key);
  return value === undefined || value === null || value === ''
    ? '-'
    : String(value);
}

function getBooleanLabelByKey(
  sn: LocalSerialNumber,
  key: string,
  trueLabel = 'X',
  falseLabel = '-',
): string {
  const value = valueByKey(sn, key);
  if (value === undefined) return '-';
  return value ? trueLabel : falseLabel;
}

function getRangeByKey(
  sn: LocalSerialNumber,
  minKey: string,
  maxKey: string,
): string {
  const min = valueByKey(sn, minKey);
  const max = valueByKey(sn, maxKey);
  if (min === undefined || min === null || min === '') return '-';
  return `${String(min)} - ${String(max ?? '')}`.trim();
}
