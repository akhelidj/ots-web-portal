/**
 * The DEFINED-STATE predicate `isTemplateDefined` — the single source of truth that both the
 * templates-list row action (View vs Define) and the Define page's read-only recap branch key
 * off. Locking it here guarantees the label and the recap can never drift: a template the list
 * calls "View" is exactly one the Define page opens read-only.
 */
import {
  isTemplateDefined,
  StoredDefinition,
} from './admin-templates.service';

const defined: StoredDefinition = {
  fields: [
    { key: 'sn', label: 'Serial Number', type: 'text', required: false, scope: 'item', role: 'serialNumber' },
  ],
};

describe('isTemplateDefined — defined-state detection', () => {
  it('is false for a never-defined template (null)', () => {
    expect(isTemplateDefined(null)).toBe(false);
    expect(isTemplateDefined(undefined)).toBe(false);
  });

  it('is false for an empty/garbled definition with no fields', () => {
    expect(isTemplateDefined({ fields: [] })).toBe(false);
    // A missing/non-array fields is treated as undefined too.
    expect(isTemplateDefined({} as unknown as StoredDefinition)).toBe(false);
  });

  it('is true once the stored definition carries at least one field', () => {
    expect(isTemplateDefined(defined)).toBe(true);
  });
});
