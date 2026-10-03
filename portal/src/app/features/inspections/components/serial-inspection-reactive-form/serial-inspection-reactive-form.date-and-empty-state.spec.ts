/**
 * Phase D step 2b — decisive DOM proofs for the form component:
 *
 *   1. `date` render branch: a `type:'date'` item field renders a NATIVE date control
 *      (`<input type="date">`) that is form-bound — not the blank fall-through the
 *      switch produced before the branch existed. Decisive: the assertion can only hold
 *      on the date path (a text/blank fallback has no `input[type="date"]`).
 *
 *   2. Empty-state fallback (two arms):
 *        - a report WITH a non-null definition (the committed drill-pipe definition)
 *          still renders its real form — NOT the empty-state;
 *        - a report with NO usable definition (null / malformed) renders the explicit
 *          empty-state and renders ZERO form controls — NOT the drill-pipe schema.
 *      MUTATION GUARD: repoint the ngOnInit fallback back at DRILL_PIPE_V1_SCHEMA and the
 *      "renders zero controls" assertions go RED (drill-pipe inputs appear) — so the
 *      empty-state proof is non-vacuous.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SerialInspectionReactiveFormComponent } from './serial-inspection-reactive-form.component';
import { TemplateFormDefinition } from '@portal/features/templates/schemas/definition-to-form-schema';

function loadDrillDefinition(): TemplateFormDefinition {
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

/** A minimal non-drill-pipe definition carrying a `date` item field. */
const DATE_DEFINITION: TemplateFormDefinition = {
  templateKey: 'ARBITRARY_REPORT',
  templateVersion: 1,
  sections: [{ key: 'meta', title: 'Metadata' }],
  fields: [
    {
      key: 'meta.reportDate',
      label: 'Report Date',
      type: 'date',
      required: false,
      scope: 'item',
      section: 'meta',
    },
    {
      key: 'meta.name',
      label: 'Name',
      type: 'text',
      required: true,
      scope: 'item',
      section: 'meta',
    },
  ],
};

describe('SerialInspectionReactiveForm — date branch + empty-state fallback', () => {
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

  describe('deliverable 2 — the date render branch', () => {
    it('renders a native date control (not a text/blank fallback) for a date field', () => {
      const fixture = render(DATE_DEFINITION);
      const el = fixture.nativeElement as HTMLElement;

      const dateInput = el.querySelector<HTMLInputElement>('#meta_reportDate');
      expect(dateInput).not.toBeNull();
      // Decisive: only the date branch produces an <input type="date">.
      expect(dateInput!.tagName).toBe('INPUT');
      expect(dateInput!.getAttribute('type')).toBe('date');

      // The sibling text field is a separate, non-date input — proving the branch is
      // type-specific, not a blanket input.
      const textInput = el.querySelector<HTMLInputElement>('#meta_name');
      expect(textInput!.getAttribute('type')).toBe('text');
    });

    it('two-way binds the date control to its form control', () => {
      const fixture = render(DATE_DEFINITION);
      const c = fixture.componentInstance;
      const el = fixture.nativeElement as HTMLElement;

      c.formGroup.get('meta_reportDate')!.setValue('2026-08-17');
      fixture.detectChanges();
      const dateInput = el.querySelector<HTMLInputElement>('#meta_reportDate')!;
      expect(dateInput.value).toBe('2026-08-17'); // model → view

      dateInput.value = '2025-01-02';
      dateInput.dispatchEvent(new Event('input'));
      expect(c.formGroup.get('meta_reportDate')!.value).toBe('2025-01-02'); // view → model
    });
  });

  describe('deliverable 3 — empty-state fallback (two arms)', () => {
    it('ARM 1: a report WITH a non-null definition still renders its form (not empty-state)', () => {
      const fixture = render(loadDrillDefinition());
      const c = fixture.componentInstance;
      const el = fixture.nativeElement as HTMLElement;

      expect(c.schemaUnavailable).toBe(false);
      expect(el.querySelector('[data-testid="form-unavailable"]')).toBeNull();
      // A known drill-pipe control renders (the EMI Result select).
      expect(el.querySelector('#body_emiResult')).not.toBeNull();
    });

    it('ARM 2: a report with NO usable definition shows the empty-state and ZERO controls', () => {
      for (const noDef of [null, { fields: 'nope' }, 'garbage', 42] as unknown[]) {
        const fixture = render(noDef as TemplateFormDefinition | null);
        const c = fixture.componentInstance;
        const el = fixture.nativeElement as HTMLElement;

        // Soft-null: never throws, flags the empty-state.
        expect(c.schemaUnavailable).toBe(true);
        expect(el.querySelector('[data-testid="form-unavailable"]')).not.toBeNull();

        // Decisive + mutation-guarded: NO form controls render. Were the fallback the
        // drill-pipe schema, dozens of inputs/selects would appear here → RED.
        expect(el.querySelectorAll('input, select').length).toBe(0);
        expect(el.querySelector('#body_emiResult')).toBeNull();
        expect(Object.keys(c.formGroup.controls).length).toBe(0);
      }
    });
  });
});
