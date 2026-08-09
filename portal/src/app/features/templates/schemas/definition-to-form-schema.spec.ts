/**
 * Layer A — Phase B3 form-schema adapter equivalence (portal unit).
 *
 * Proves `definitionToFormSchema`, fed the REAL committed drill-pipe definition
 * (the shipped api/.../drill-pipe-v1.definition.json), reproduces the hardcoded
 * DRILL_PIPE_V1_SCHEMA exactly — field set, keys, labels, inputTypes, required
 * flags, options, section grouping, section titles, and order. One `toEqual` pins
 * all of it. The definition is loaded from the shipped file (documented cross-app
 * test coupling — there is no shared package, ADR-0008), so this binds to the real
 * artifact, not a fixture.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DRILL_PIPE_V1_SCHEMA } from './drill-pipe-v1.schema';
import {
  definitionToFormSchema,
  TemplateFormDefinition,
} from './definition-to-form-schema';

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

describe('Layer A — definitionToFormSchema == DRILL_PIPE_V1_SCHEMA', () => {
  it('reproduces the hardcoded schema exactly from the committed definition', () => {
    expect(definitionToFormSchema(DEF)).toEqual(DRILL_PIPE_V1_SCHEMA);
  });

  it('groups box.hardBanding LAST in the Box section (gate reorder does not leak)', () => {
    const box = definitionToFormSchema(DEF).sections.find((s) => s.key === 'box');
    expect(box?.fields.map((f) => f.key)).toEqual(
      DRILL_PIPE_V1_SCHEMA.sections.find((s) => s.key === 'box')!.fields.map(
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
      expect(definitionToFormSchema(mutant)).not.toEqual(DRILL_PIPE_V1_SCHEMA);
    });

    it('removing a select option makes the adapter output diverge', () => {
      const mutant = clone();
      const emi = mutant.fields.find((f) => f.key === 'body.emiResult')!;
      emi.options = ['PASS', 'SCRAP', 'HOLD']; // drop REWORK
      expect(definitionToFormSchema(mutant)).not.toEqual(DRILL_PIPE_V1_SCHEMA);
    });

    it('changing a section title makes the adapter output diverge', () => {
      const mutant = clone();
      mutant.sections!.find((s) => s.key === 'box')!.title = 'Box';
      expect(definitionToFormSchema(mutant)).not.toEqual(DRILL_PIPE_V1_SCHEMA);
    });
  });
});
