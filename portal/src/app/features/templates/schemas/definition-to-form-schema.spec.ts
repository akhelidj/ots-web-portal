/**
 * Layer A — Phase B3 form-schema adapter equivalence (portal unit).
 *
 * Proves `definitionToFormSchema`, fed the REAL committed drill-pipe definition
 * (the shipped api/.../drill-pipe-v1.definition.json), reproduces the frozen
 * GOLDEN_FORM_SCHEMA exactly — field set, keys, labels, inputTypes, required
 * flags, options, section grouping, section titles, and order. One `toEqual` pins
 * all of it. The golden is a hand-materialized snapshot (below), severed from the
 * live DRILL_PIPE_V1_SCHEMA const so equivalence cannot pass vacuously. The definition
 * is loaded from the shipped file (documented cross-app test coupling — there is no
 * shared package, ADR-0008), so this binds to the real artifact, not a fixture.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FormSchema } from './drill-pipe-v1.schema';
import {
  definitionToFormSchema,
  TemplateFormDefinition,
} from './definition-to-form-schema';

/**
 * Frozen, hand-materialized golden — the full FormSchema `definitionToFormSchema` is
 * expected to produce for the committed drill-pipe definition. Written out by hand, NOT
 * imported from DRILL_PIPE_V1_SCHEMA, NOT derived from the definition, NOT built by any
 * helper the engine touches: it shares ZERO machinery with definitionToFormSchema, so the
 * equivalence below cannot pass vacuously. (Severed from the live const, which stays as
 * the runtime null fallback.) Independent-literal anchors kept visible:
 *   - body.emiResult.options === ['PASS','REWORK','SCRAP','HOLD']
 *   - box.hardBanding is the LAST field of the box section
 */
const GOLDEN_FORM_SCHEMA: FormSchema = {
  templateKey: 'DRILL_PIPE_REPORT',
  templateVersion: 1,
  sections: [
    {
      key: 'box',
      title: 'Box Connection',
      fields: [
        { key: 'box.minTongSpace', label: 'Min Tong Space', inputType: 'text', required: true },
        { key: 'box.minOD', label: 'Min OD', inputType: 'text', required: true },
        { key: 'box.minBoxThreads', label: 'Min Box Threads', inputType: 'text', required: true },
        { key: 'box.minEccShoulder', label: 'Min Ecc Shoulder', inputType: 'text', required: true },
        { key: 'box.maxCounterBoreDiameter', label: 'Max Counter Bore Diameter', inputType: 'text', required: true },
        { key: 'box.maxCounterBoreLength', label: 'Max Counter Bore Length', inputType: 'text', required: true },
        { key: 'box.bevelDiameterMin', label: 'Bevel Diameter Min', inputType: 'text', required: true },
        { key: 'box.bevelDiameterMax', label: 'Bevel Diameter Max', inputType: 'text', required: true },
        { key: 'box.condition', label: 'Condition', inputType: 'text', required: true },
        { key: 'box.hardBanding', label: 'Hard Banding', inputType: 'text', required: true },
      ],
    },
    {
      key: 'pin',
      title: 'Pin Connection',
      fields: [
        { key: 'pin.minTongSpace', label: 'Min Tong Space', inputType: 'text', required: true },
        { key: 'pin.minOD', label: 'Min OD', inputType: 'text', required: true },
        { key: 'pin.maxID', label: 'Max ID', inputType: 'text', required: true },
        { key: 'pin.minEccShoulder', label: 'Min Ecc Shoulder', inputType: 'text', required: true },
        { key: 'pin.lengthPinConnMin', label: 'Length Pin Conn Min', inputType: 'text', required: true },
        { key: 'pin.lengthPinConnMax', label: 'Length Pin Conn Max', inputType: 'text', required: true },
        { key: 'pin.maxLengthPinBase', label: 'Max Length Pin Base', inputType: 'text', required: true },
        { key: 'pin.bevelDiameterMin', label: 'Bevel Diameter Min', inputType: 'text', required: true },
        { key: 'pin.bevelDiameterMax', label: 'Bevel Diameter Max', inputType: 'text', required: true },
        { key: 'pin.condition', label: 'Condition', inputType: 'text', required: true },
      ],
    },
    {
      key: 'body',
      title: 'Body',
      fields: [
        { key: 'body.wallRemaining', label: 'Wall Remaining', inputType: 'text', required: true },
        { key: 'body.odDecrease', label: 'OD Decrease', inputType: 'text', required: true },
        { key: 'body.emiResult', label: 'EMI Result', inputType: 'select', required: true, options: ['PASS', 'REWORK', 'SCRAP', 'HOLD'] },
        { key: 'body.slipArea', label: 'Slip Area', inputType: 'text', required: true },
        { key: 'body.corrosionIn', label: 'Corrosion Inside', inputType: 'boolean', required: true },
        { key: 'body.corrosionOut', label: 'Corrosion Outside', inputType: 'boolean', required: true },
        { key: 'body.ipc', label: 'IPC', inputType: 'boolean', required: true },
        { key: 'body.bentJoints', label: 'Bent Joints', inputType: 'boolean', required: true },
      ],
    },
    {
      key: 'final',
      title: 'Final Disposition',
      fields: [
        { key: 'final.isNew', label: 'Is New', inputType: 'boolean', required: true },
        { key: 'final.isPremium', label: 'Is Premium', inputType: 'boolean', required: true },
        { key: 'final.isC2', label: 'Is C2', inputType: 'boolean', required: true },
        { key: 'final.isScrap', label: 'Is Scrap', inputType: 'boolean', required: true },
      ],
    },
    {
      key: 'remarksSection',
      title: 'Additional Information',
      fields: [
        { key: 'remarks', label: 'Remarks', inputType: 'text', required: false },
      ],
    },
  ],
};

function loadRealDefinition(): TemplateFormDefinition {
  const rel = 'api/src/app/template/definitions/drill-pipe-v1.definition.json';
  const candidates = [
    resolve(process.cwd(), rel),
    resolve(__dirname, '../../../../../../', rel),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  }
  throw new Error(`Could not locate committed definition at any of: ${candidates.join(', ')}`);
}

const DEF = loadRealDefinition();
const clone = (): TemplateFormDefinition =>
  JSON.parse(JSON.stringify(DEF)) as TemplateFormDefinition;

describe('Layer A — definitionToFormSchema == GOLDEN_FORM_SCHEMA (frozen)', () => {
  it('reproduces the golden schema exactly from the committed definition', () => {
    expect(definitionToFormSchema(DEF)).toEqual(GOLDEN_FORM_SCHEMA);
  });

  it('groups box.hardBanding LAST in the Box section (gate reorder does not leak)', () => {
    const box = definitionToFormSchema(DEF).sections.find((s) => s.key === 'box');
    expect(box?.fields.map((f) => f.key)).toEqual(
      GOLDEN_FORM_SCHEMA.sections.find((s) => s.key === 'box')!.fields.map(
        (f) => f.key,
      ),
    );
    expect(box?.fields[box.fields.length - 1].key).toBe('box.hardBanding');
  });

  it('carries options only on select fields (emiResult), omitted elsewhere', () => {
    const fields = definitionToFormSchema(DEF).sections.flatMap((s) => s.fields);
    expect(fields.find((f) => f.key === 'body.emiResult')?.options).toEqual([
      'PASS',
      'REWORK',
      'SCRAP',
      'HOLD',
    ]);
    expect('options' in (fields.find((f) => f.key === 'box.minOD') ?? {})).toBe(
      false,
    );
  });

  describe('mutation guard — the toEqual comparison is not vacuous', () => {
    it('dropping a required flag makes the adapter output diverge', () => {
      const mutant = clone();
      mutant.fields.find((f) => f.key === 'box.minOD')!.required = false;
      expect(definitionToFormSchema(mutant)).not.toEqual(GOLDEN_FORM_SCHEMA);
    });

    it('removing a select option makes the adapter output diverge', () => {
      const mutant = clone();
      const emi = mutant.fields.find((f) => f.key === 'body.emiResult')!;
      emi.options = ['PASS', 'SCRAP', 'HOLD']; // drop REWORK
      expect(definitionToFormSchema(mutant)).not.toEqual(GOLDEN_FORM_SCHEMA);
    });

    it('changing a section title makes the adapter output diverge', () => {
      const mutant = clone();
      mutant.sections!.find((s) => s.key === 'box')!.title = 'Box';
      expect(definitionToFormSchema(mutant)).not.toEqual(GOLDEN_FORM_SCHEMA);
    });
  });
});
