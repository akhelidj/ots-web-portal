/**
 * Layer B — Phase B3 form-BUILD equivalence (portal component).
 *
 * Builds the real SerialInspectionReactiveFormComponent two ways from the SAME
 * initialData — once with `definition` set to the committed drill-pipe definition
 * (engine path) and once with no definition (legacy hardcoded schema) — and proves
 * the built reactive form is equivalent: same control set, same validator behavior
 * (incl. the false-is-valid boolean gotcha), same emiResult options, same submit
 * shape. A mutation guard proves the comparison detects divergence.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { SerialInspectionReactiveFormComponent } from './serial-inspection-reactive-form.component';
import { TemplateFormDefinition } from '@portal/features/templates/schemas/definition-to-form-schema';

function loadRealDefinition(): TemplateFormDefinition {
  const rel = 'api/src/app/template/definitions/drill-pipe-v1.definition.json';
  const candidates = [
    resolve(process.cwd(), rel),
    resolve(__dirname, '../../../../../../../', rel),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  }
  throw new Error(`Could not locate committed definition at: ${candidates.join(', ')}`);
}

const DEF = loadRealDefinition();
const clone = (): TemplateFormDefinition =>
  JSON.parse(JSON.stringify(DEF)) as TemplateFormDefinition;

/** All item fields populated → a fully-valid form (text '1', booleans true). */
const FULL_DATA: Record<string, unknown> = {
  box: {
    minTongSpace: '1',
    minOD: '1',
    minBoxThreads: '1',
    minEccShoulder: '1',
    maxCounterBoreDiameter: '1',
    maxCounterBoreLength: '1',
    bevelDiameterMin: '1',
    bevelDiameterMax: '1',
    condition: '1',
    hardBanding: '1',
  },
  pin: {
    minTongSpace: '1',
    minOD: '1',
    maxID: '1',
    minEccShoulder: '1',
    lengthPinConnMin: '1',
    lengthPinConnMax: '1',
    maxLengthPinBase: '1',
    bevelDiameterMin: '1',
    bevelDiameterMax: '1',
    condition: '1',
  },
  body: {
    wallRemaining: '1',
    odDecrease: '1',
    emiResult: 'PASS',
    slipArea: '1',
    corrosionIn: true,
    corrosionOut: true,
    ipc: true,
    bentJoints: true,
  },
  final: { isNew: true, isPremium: true, isC2: true, isScrap: true },
  remarks: 'note',
};

describe('Layer B — engine-built form == legacy-built form (drill pipe)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SerialInspectionReactiveFormComponent],
    });
  });

  function build(
    definition: TemplateFormDefinition | null,
    initialData: Record<string, unknown> = {},
  ): SerialInspectionReactiveFormComponent {
    const fixture = TestBed.createComponent(
      SerialInspectionReactiveFormComponent,
    );
    const c = fixture.componentInstance;
    c.definition = definition;
    c.initialData = initialData;
    c.ngOnInit();
    return c;
  }

  /** Map of control name → invalid-when-empty (i.e. carries Validators.required). */
  function requiredMap(c: SerialInspectionReactiveFormComponent) {
    const map: Record<string, boolean> = {};
    for (const key of Object.keys(c.formGroup.controls)) {
      const ctrl = c.formGroup.get(key)!;
      ctrl.setValue('');
      map[key] = ctrl.invalid;
    }
    return map;
  }

  it('builds the identical control set', () => {
    const engine = build(DEF);
    const legacy = build(null);
    expect(Object.keys(engine.formGroup.controls).sort()).toEqual(
      Object.keys(legacy.formGroup.controls).sort(),
    );
  });

  it('applies Validators.required to the identical set of controls', () => {
    expect(requiredMap(build(DEF))).toEqual(requiredMap(build(null)));
  });

  it('GOTCHA: false satisfies required on a boolean control (both paths)', () => {
    const engine = build(DEF);
    const legacy = build(null);
    for (const c of [engine, legacy]) {
      const ipc = c.formGroup.get('body_ipc')!;
      ipc.setValue(false);
      expect(ipc.valid).toBe(true); // false is present → required passes
      ipc.setValue('');
      expect(ipc.invalid).toBe(true); // empty string → required fails
    }
    // and the two paths agree on both probes
    const eIpc = engine.formGroup.get('body_ipc')!;
    const lIpc = legacy.formGroup.get('body_ipc')!;
    eIpc.setValue(false);
    lIpc.setValue(false);
    expect(eIpc.valid).toBe(lIpc.valid);
  });

  it('exposes identical emiResult options (incl. excludedDispositions)', () => {
    const engine = build(DEF);
    const legacy = build(null);
    const emiField = (c: SerialInspectionReactiveFormComponent) =>
      c.schema.sections
        .flatMap((s) => s.fields)
        .find((f) => f.key === 'body.emiResult')!;
    expect(engine.getFieldOptions(emiField(engine))).toEqual(
      legacy.getFieldOptions(emiField(legacy)),
    );

    engine.excludedDispositions = ['REWORK'];
    legacy.excludedDispositions = ['REWORK'];
    expect(engine.getFieldOptions(emiField(engine))).toEqual(
      legacy.getFieldOptions(emiField(legacy)),
    );
    expect(engine.getFieldOptions(emiField(engine))).not.toContain('REWORK');
  });

  it('emits the identical nested submit payload', () => {
    const engine = build(DEF, structuredClone(FULL_DATA));
    const legacy = build(null, structuredClone(FULL_DATA));

    let engineOut: unknown;
    let legacyOut: unknown;
    engine.saveData.subscribe((v) => (engineOut = v));
    legacy.saveData.subscribe((v) => (legacyOut = v));

    expect(engine.formGroup.valid).toBe(true);
    expect(legacy.formGroup.valid).toBe(true);
    engine.onSubmit();
    legacy.onSubmit();

    expect(engineOut).toEqual(legacyOut);
  });

  describe('mutation guard — the form-build comparison is not vacuous', () => {
    it('dropping a required flag diverges the validator map', () => {
      const mutant = clone();
      mutant.fields.find((f) => f.key === 'box.minOD')!.required = false;
      const engine = build(mutant);
      const legacy = build(null);

      const e = engine.formGroup.get('box_minOD')!;
      const l = legacy.formGroup.get('box_minOD')!;
      e.setValue('');
      l.setValue('');
      expect(e.invalid).toBe(false); // no longer required in the mutant
      expect(l.invalid).toBe(true); // still required in legacy
      expect(requiredMap(engine)).not.toEqual(requiredMap(legacy));
    });
  });
});
