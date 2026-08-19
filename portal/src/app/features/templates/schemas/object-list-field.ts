/**
 * The generic `object-list` field's row shape — ONE definition, consumed everywhere an
 * object-list value is built, emitted, or displayed, so the four former copies of the
 * `{ name, number }` literal can no longer drift apart.
 *
 * An object-list is the generic array field type (equipment, methods, attachments, …):
 * a list of `{ name, number }` rows, dispatched by declared TYPE with no field-name
 * awareness. Consumers:
 *   - the shared field-input primitive (seeds/creates rows, renders the two controls);
 *   - the header edit's `onSave` (maps + drops empty rows into the emitted map);
 *   - the header read view's `displayValue` (formats a row for display).
 */

/** One object-list row. Values are strings once they pass through the form controls. */
export interface ObjectListRow {
  name: string;
  number: string;
}

/**
 * The row's control keys, as the single source of truth for the form-control names the
 * primitive template binds (`formControlName="name"` / `"number"`). Referenced by the
 * row builder so a rename here surfaces at the builder rather than silently diverging
 * from the template.
 */
export const OBJECT_LIST_ROW_KEYS = ['name', 'number'] as const;

/**
 * Coerce an arbitrary seed value (from stored data or a form control) into a row,
 * defaulting each key to `''` — matching the former inline `rec['name'] ?? ''` shape
 * the edit form seeded and emitted.
 */
export function toObjectListRow(raw: unknown): ObjectListRow {
  const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    name: (rec['name'] ?? '') as string,
    number: (rec['number'] ?? '') as string,
  };
}

/** True when both cells are blank — the rows `onSave` drops. */
export function isObjectListRowEmpty(row: ObjectListRow): boolean {
  return String(row.name).trim() === '' && String(row.number).trim() === '';
}

/**
 * Display form for one row: `name #number` when a number is present, else `name`.
 * Reads the raw value (not a coerced row) to preserve the read view's exact prior
 * truthiness (`number ? … : …`), so an object-list renders identically after the dedup.
 */
export function formatObjectListRow(raw: unknown): string {
  const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const name = rec['name'] ?? '';
  const number = rec['number'];
  return number ? `${String(name)} #${String(number)}` : String(name);
}
