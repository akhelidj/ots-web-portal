/**
 * Phase D step 2 — decisive DOM proof that the Specs tab's header EDIT is GENERIC:
 * fields AND their editors come from the template definition (dispatched by field
 * TYPE, never field name), and Save emits ONE definition-keyed header map that the
 * parent persists to the record's generic `headerData` store.
 *
 * DECISIVE DISCRIMINATORS (each true ONLY on the generic path):
 *   1. A non-drill-pipe scalar field ("Cert Number") renders and round-trips — the
 *      view is not drill-pipe-shaped.
 *   2. An `object-list` field is edited through the GENERIC array editor and the
 *      emitted value is an ARRAY of `{ name, number }` — the hardcoded scalar path
 *      could never produce that, and no field-name special-casing is involved.
 *
 * ZONELESS DISCIPLINE: inputs feed signals and the form is rebuilt in an `effect`,
 * so change detection is scheduler-driven. This spec renders the DOM and drives it
 * with real `input`/`click` events + `autoDetectChanges()` / `whenStable()` only —
 * NO manual `detectChanges()` that would mask a missing-notification bug.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InspectionReportHeaderEditComponent } from './inspection-report-header-edit.component';
import { TemplateFormDefinition } from '@portal/features/templates/schemas/definition-to-form-schema';

/**
 * A synthetic, NON-drill-pipe flat definition. Its header labels ("Cert Number",
 * "Attachments") appear in no drill-pipe template, so drill pipe cannot be the
 * oracle. `attachments` is the generic `object-list` array type.
 */
const SYNTHETIC: TemplateFormDefinition = {
  templateKey: 'LIFTING_GEAR_INSPECTION',
  templateVersion: 2,
  sections: [],
  regions: [{ id: 'r1', marker: '{{tag}}' }],
  fields: [
    {
      key: 'certNumber',
      label: 'Cert Number',
      type: 'text',
      required: false,
      scope: 'header',
    },
    {
      key: 'attachments',
      label: 'Attachments',
      type: 'object-list',
      required: false,
      scope: 'header',
    },
    // An item-scope field must NOT appear in the header edit.
    {
      key: 'result',
      label: 'Result',
      type: 'select',
      required: true,
      scope: 'item',
      section: 'body',
      options: ['PASS', 'FAIL'],
    },
  ],
};

describe('InspectionReportHeaderEditComponent — generic definition-driven header edit (DOM)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function setup(): ComponentFixture<InspectionReportHeaderEditComponent> {
    TestBed.configureTestingModule({
      imports: [InspectionReportHeaderEditComponent],
    });
    return TestBed.createComponent(InspectionReportHeaderEditComponent);
  }

  function typeInto(el: HTMLElement, selector: string, value: string): void {
    const input = el.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`no element for ${selector}`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  it('renders header-scope fields by type, edits the generic object-list, and emits a definition-keyed map', async () => {
    const fixture = setup();
    const c = fixture.componentInstance;
    const el = () => fixture.nativeElement as HTMLElement;

    const emitted: Record<string, unknown>[] = [];
    c.save.subscribe((v) => emitted.push(v));

    c.definition = SYNTHETIC;
    c.data = { certNumber: 'CERT-1', attachments: [{ name: 'Sling', number: 'S-1' }] };

    fixture.autoDetectChanges();
    await fixture.whenStable();

    // Non-drill-pipe scalar field present; item-scope field absent.
    expect(el().querySelector('[data-testid="header-edit-field-certNumber"]')).not.toBeNull();
    expect(el().textContent).toContain('Cert Number');
    expect(el().querySelector('[data-testid="header-edit-field-result"]')).toBeNull();
    expect(el().textContent).not.toContain('Result');

    // The object-list seeded one row through the GENERIC array editor.
    expect(
      el().querySelector<HTMLInputElement>(
        '[data-testid="header-edit-attachments-name-0"]',
      )?.value,
    ).toBe('Sling');

    // Edit the scalar and add a second object-list row via real DOM events.
    typeInto(el(), '[data-testid="header-edit-input-certNumber"]', 'CERT-2');

    el()
      .querySelector<HTMLButtonElement>('[data-testid="header-edit-attachments-add"]')!
      .click();
    await fixture.whenStable();
    typeInto(el(), '[data-testid="header-edit-attachments-name-1"]', 'Hook');
    typeInto(el(), '[data-testid="header-edit-attachments-number-1"]', 'H-9');

    // Save.
    el().querySelector<HTMLButtonElement>('[data-testid="header-edit-save"]')!.click();
    await fixture.whenStable();

    expect(emitted.length).toBe(1);
    const map = emitted[0]!;
    // Scalar round-trips by field key…
    expect(map['certNumber']).toBe('CERT-2');
    // …and the DECISIVE discriminator: object-list emits an ARRAY of {name,number}.
    expect(Array.isArray(map['attachments'])).toBe(true);
    expect(map['attachments']).toEqual([
      { name: 'Sling', number: 'S-1' },
      { name: 'Hook', number: 'H-9' },
    ]);
  });

  it('MUTATION GUARD: a definition with zero header-scope fields shows the empty-state and emits nothing editable', async () => {
    const fixture = setup();
    const c = fixture.componentInstance;
    const el = () => fixture.nativeElement as HTMLElement;

    // Broken via input DATA (not a test literal): every field forced to item scope,
    // so the header slice is empty. If the render assertions were vacuous, the
    // fields would still show; instead the empty-state must appear.
    c.definition = {
      ...SYNTHETIC,
      fields: SYNTHETIC.fields.map((f) => ({ ...f, scope: 'item' as const })),
    };
    c.data = {};
    fixture.autoDetectChanges();
    await fixture.whenStable();

    expect(el().querySelector('[data-testid="header-edit-unavailable"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="header-edit-field-certNumber"]')).toBeNull();
    expect(el().querySelector('[data-testid="header-edit-save"]')).toBeNull();
  });

  it('drill-pipe object-list fields (equipment/methods) render through the SAME generic array editor', async () => {
    // Retype proof: equipmentUsed is now type `object-list` in the drill-pipe
    // definition, so it renders with the generic array editor — not a text box —
    // dispatched purely by type.
    const DRILL: TemplateFormDefinition = {
      templateKey: 'DRILL_PIPE_REPORT',
      templateVersion: 1,
      sections: [],
      regions: [{ id: 'serials', marker: '{{sn}}' }],
      fields: [
        { key: 'grade', label: 'Grade', type: 'text', required: false, scope: 'header' },
        {
          key: 'equipmentUsed',
          label: 'Equipment Used',
          type: 'object-list',
          required: false,
          scope: 'header',
        },
      ],
    };

    const fixture = setup();
    const c = fixture.componentInstance;
    const el = () => fixture.nativeElement as HTMLElement;

    c.definition = DRILL;
    c.data = { grade: 'S-135', equipmentUsed: [{ name: 'UT Gauge', number: 'UT-9' }] };
    fixture.autoDetectChanges();
    await fixture.whenStable();

    // Scalar grade is a plain input; equipment is the structured array editor.
    expect(el().querySelector('[data-testid="header-edit-input-grade"]')).not.toBeNull();
    expect(
      el().querySelector<HTMLInputElement>(
        '[data-testid="header-edit-equipmentUsed-name-0"]',
      )?.value,
    ).toBe('UT Gauge');
    expect(
      el().querySelector<HTMLInputElement>(
        '[data-testid="header-edit-equipmentUsed-number-0"]',
      )?.value,
    ).toBe('UT-9');
  });
});
