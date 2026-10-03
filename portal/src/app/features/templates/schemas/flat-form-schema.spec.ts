/**
 * Flat (region-less) form-schema adaptation — Phase D flat step 3 (portal unit).
 *
 * The adapter's mode switch is an EXPLICIT discriminator on `regions.length`:
 *   - region template (`regions.length === 1`) → item-scope fields only (unchanged;
 *     the drill-pipe golden in definition-to-form-schema.spec.ts pins this exactly);
 *   - flat template (`regions.length === 0`) → EVERY field (header + item) renders,
 *     because a flat definition IS one record's form and its header fields have no
 *     "elsewhere" to live.
 *
 * These are the schema-object proofs; the DOM proof (fields actually render as inputs,
 * flat never hits the empty-state) lives in the component spec
 * serial-inspection-reactive-form.flat-render.spec.ts.
 */
import {
  definitionToFormSchema,
  TemplateFormDefinition,
} from './definition-to-form-schema';

/**
 * A FLAT definition in the exact shape step-2's builder emits for a header-only ops
 * description: `regions: []`, a header-scope metadata field (poNumber, no section) and
 * an item-scope record field (casingWeight, section 'Body'). `sections` is derived from
 * the item field only — the header field is deliberately section-less, exercising the
 * leftover-group path.
 */
const FLAT_DEF: TemplateFormDefinition = {
  templateKey: 'CASING_FLAT',
  templateVersion: 1,
  sections: [{ key: 'Body', title: 'Body' }],
  regions: [],
  fields: [
    { key: 'poNumber', label: 'PO Number', type: 'text', required: false, scope: 'header' },
    {
      key: 'casingWeight',
      label: 'Casing Weight',
      type: 'text',
      required: true,
      scope: 'item',
      section: 'Body',
    },
  ],
};

/**
 * A REGION definition (regions.length === 1) with the same two fields. Its header field
 * must STILL be dropped (item-scope only) — the mode switch must not change this.
 */
const REGION_DEF: TemplateFormDefinition = {
  templateKey: 'CASING_REGION',
  templateVersion: 1,
  sections: [{ key: 'Body', title: 'Body' }],
  regions: [{ id: 'serials', marker: '{{sn}}' }],
  fields: [
    { key: 'poNumber', label: 'PO Number', type: 'text', required: false, scope: 'header' },
    {
      key: 'casingWeight',
      label: 'Casing Weight',
      type: 'text',
      required: true,
      scope: 'item',
      section: 'Body',
    },
  ],
};

const allFieldKeys = (def: TemplateFormDefinition): string[] =>
  definitionToFormSchema(def).sections.flatMap((s) => s.fields.map((f) => f.key));

describe('Flat form-schema adaptation — the regions.length mode switch', () => {
  describe('flat template (regions.length === 0) renders EVERY field', () => {
    it('includes both the header field and the item field', () => {
      const keys = allFieldKeys(FLAT_DEF);
      expect(keys).toContain('poNumber'); // header field — rendered in flat mode
      expect(keys).toContain('casingWeight'); // item/record field
      expect(keys).toHaveLength(2);
    });

    it('emits the section-less header field in a trailing (leftover) group', () => {
      const schema = definitionToFormSchema(FLAT_DEF);
      // Declared section carries the item field…
      const body = schema.sections.find((s) => s.key === 'Body');
      expect(body?.fields.map((f) => f.key)).toEqual(['casingWeight']);
      // …and the section-less header field is not dropped — it lands in a leftover group.
      const leftover = schema.sections.find((s) => s.key === '');
      expect(leftover?.fields.map((f) => f.key)).toEqual(['poNumber']);
    });

    it('preserves field type/required/options onto the rendered controls', () => {
      const fields = definitionToFormSchema(FLAT_DEF).sections.flatMap((s) => s.fields);
      const casing = fields.find((f) => f.key === 'casingWeight')!;
      expect(casing.inputType).toBe('text');
      expect(casing.required).toBe(true);
    });
  });

  describe('region template (regions.length === 1) is UNCHANGED', () => {
    it('still drops the header field, keeping item-scope only', () => {
      const keys = allFieldKeys(REGION_DEF);
      expect(keys).toEqual(['casingWeight']); // header poNumber dropped, as before
    });
  });

  describe('the discriminator is EXPLICIT, not emptiness inference', () => {
    it('flat vs region on the SAME fields differ only by regions.length', () => {
      // Identical fields; the only difference is the region count. Flat renders both,
      // region renders one — proving the switch keys off regions.length, not the field set.
      expect(allFieldKeys(FLAT_DEF).sort()).toEqual(['casingWeight', 'poNumber']);
      expect(allFieldKeys(REGION_DEF)).toEqual(['casingWeight']);
    });

    it('a definition with ABSENT regions is treated as region (conservative default)', () => {
      // No `regions` property at all → NOT flat → item-scope filter (header dropped).
      const noRegions = { ...FLAT_DEF, regions: undefined };
      expect(allFieldKeys(noRegions)).toEqual(['casingWeight']);
    });
  });
});
