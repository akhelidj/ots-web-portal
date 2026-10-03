/**
 * Phase D flat step 3 — decisive DOM proof that a FLAT (region-less) definition renders
 * its fields as real form controls, and NEVER falls through to the empty-state.
 *
 * Why DOM, not just the adapter's return value: the zoneless conversion earlier showed a
 * schema can be correct while the view stays blank. So this RENDERS the component and
 * asserts the actual <input> elements exist — the same discipline that caught the
 * silent-empty-form bug for the date branch.
 *
 * Two-arm empty-state proof:
 *   - a VALID flat definition (header + item fields) renders its inputs, NOT the
 *     empty-state;
 *   - a genuinely null/malformed definition still renders the empty-state and zero
 *     controls (unchanged from step 2b).
 *
 * MUTATION GUARD (non-vacuity): if the adapter reverted to the old header-drops-everything
 * behavior for flat, the flat header input (#poNumber) would vanish and the
 * "renders both inputs" assertion goes RED — so this test provably catches the empty-form
 * regression, not merely the presence of any input.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SerialInspectionReactiveFormComponent } from './serial-inspection-reactive-form.component';
import { TemplateFormDefinition } from '@portal/features/templates/schemas/definition-to-form-schema';

/**
 * A FLAT definition (regions: []) with a section-less header field (poNumber) and a
 * sectioned item/record field (casingWeight) — the shape step-2's builder emits for a
 * header-only ops description.
 */
const FLAT_DEFINITION: TemplateFormDefinition = {
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

describe('SerialInspectionReactiveForm — flat (region-less) render', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SerialInspectionReactiveFormComponent],
    });
  });

  function render(
    definition: TemplateFormDefinition | null,
  ): ComponentFixture<SerialInspectionReactiveFormComponent> {
    const fixture = TestBed.createComponent(SerialInspectionReactiveFormComponent);
    fixture.componentInstance.definition = definition;
    fixture.detectChanges();
    return fixture;
  }

  describe('a flat definition renders its fields as real controls', () => {
    it('renders BOTH the header field and the item field as inputs (DOM)', () => {
      const fixture = render(FLAT_DEFINITION);
      const el = fixture.nativeElement as HTMLElement;

      // Header-scope field renders in flat mode (would be dropped by the old item-filter).
      const header = el.querySelector<HTMLInputElement>('#poNumber');
      expect(header).not.toBeNull();
      expect(header!.tagName).toBe('INPUT');

      // Item/record field renders too.
      const record = el.querySelector<HTMLInputElement>('#casingWeight');
      expect(record).not.toBeNull();
      expect(record!.tagName).toBe('INPUT');

      // Both are wired into the reactive form group.
      const c = fixture.componentInstance;
      expect(Object.keys(c.formGroup.controls).sort()).toEqual([
        'casingWeight',
        'poNumber',
      ]);
    });

    it('two-way binds a flat control to its form control', () => {
      const fixture = render(FLAT_DEFINITION);
      const c = fixture.componentInstance;
      const el = fixture.nativeElement as HTMLElement;

      c.formGroup.get('poNumber')!.setValue('PO-9');
      fixture.detectChanges();
      const input = el.querySelector<HTMLInputElement>('#poNumber')!;
      expect(input.value).toBe('PO-9'); // model → view

      input.value = 'PO-42';
      input.dispatchEvent(new Event('input'));
      expect(c.formGroup.get('poNumber')!.value).toBe('PO-42'); // view → model
    });
  });

  describe('flat is distinguishable from "no usable definition" (two-arm)', () => {
    it('ARM 1: a valid flat definition does NOT show the empty-state', () => {
      const fixture = render(FLAT_DEFINITION);
      const c = fixture.componentInstance;
      const el = fixture.nativeElement as HTMLElement;

      expect(c.schemaUnavailable).toBe(false);
      expect(el.querySelector('[data-testid="form-unavailable"]')).toBeNull();
      // And it renders a non-zero number of controls (not a silent blank form).
      expect(el.querySelectorAll('input, select').length).toBeGreaterThan(0);
    });

    it('ARM 2: a null/malformed definition still shows the empty-state, zero controls', () => {
      for (const noDef of [null, { fields: 'nope' }, 'garbage'] as unknown[]) {
        const fixture = render(noDef as TemplateFormDefinition | null);
        const c = fixture.componentInstance;
        const el = fixture.nativeElement as HTMLElement;

        expect(c.schemaUnavailable).toBe(true);
        expect(el.querySelector('[data-testid="form-unavailable"]')).not.toBeNull();
        expect(el.querySelectorAll('input, select').length).toBe(0);
      }
    });
  });
});
