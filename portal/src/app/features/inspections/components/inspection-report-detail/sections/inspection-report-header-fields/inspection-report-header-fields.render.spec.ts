/**
 * Phase D — decisive DOM proof that the Specs tab's header-scope fields render from the
 * template DEFINITION, not the retired hardcoded drill-pipe markup.
 *
 * DECISIVE DISCRIMINATOR: the definition labels a field "Nominal WT" / "Nominal OD". The
 * old hardcoded markup used "Nom. W.T" / "Nom OD" — those exact strings can ONLY reach the
 * DOM via the definition-driven path. Asserting the definition label is present AND the old
 * hardcoded label is absent proves the render came from the definition, not leftover markup.
 *
 * ZONELESS DISCIPLINE: the app is zoneless. Inputs feed signals and the schema is a
 * `computed`, so change detection must be scheduler-driven. This spec RENDERS the DOM and
 * relies on `autoDetectChanges()` + `whenStable()` only — NO manual `detectChanges()` that
 * would mask a missing-notification bug. A driven DOM event (re-pointing the `definition`
 * input) exercises the reactive re-render.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InspectionReportHeaderFieldsComponent } from './inspection-report-header-fields.component';
import { TemplateFormDefinition } from '@portal/features/templates/schemas/definition-to-form-schema';

/**
 * A REGION (drill-pipe-shaped) definition with section-less header fields — the shape the
 * backend backfill emits. `nomWT`/`nomOD` carry definition-only labels; `emiResult` is an
 * ITEM field that must NOT leak into the header view.
 */
const DEFINITION: TemplateFormDefinition = {
  templateKey: 'DRILL_PIPE_REPORT',
  templateVersion: 1,
  sections: [{ key: 'body', title: 'Body' }],
  regions: [{ id: 'r1', marker: '{{sn}}' }],
  fields: [
    { key: 'grade', label: 'Grade', type: 'text', required: false, scope: 'header' },
    { key: 'nomWT', label: 'Nominal WT', type: 'text', required: false, scope: 'header' },
    { key: 'nomOD', label: 'Nominal OD', type: 'text', required: false, scope: 'header' },
    {
      key: 'equipmentUsed',
      label: 'Equipment Used',
      type: 'text',
      required: false,
      scope: 'header',
    },
    {
      key: 'emiResult',
      label: 'EMI Result',
      type: 'select',
      required: true,
      scope: 'item',
      section: 'body',
      options: ['PASS', 'REWORK'],
    },
  ],
};

const DATA = {
  grade: 'S-135',
  nomWT: '0.362',
  nomOD: '5.000',
  equipmentUsed: [{ name: 'UT Gauge', number: 'UT-9' }],
};

describe('InspectionReportHeaderFieldsComponent — definition-driven header render (DOM)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function setup(): ComponentFixture<InspectionReportHeaderFieldsComponent> {
    TestBed.configureTestingModule({
      imports: [InspectionReportHeaderFieldsComponent],
    });
    return TestBed.createComponent(InspectionReportHeaderFieldsComponent);
  }

  it('renders header-scope fields from the definition — with the definition-only label, not the hardcoded one', async () => {
    const fixture = setup();
    const c = fixture.componentInstance;
    const html = () => fixture.nativeElement as HTMLElement;

    c.definition = DEFINITION;
    c.data = DATA;

    // Scheduler-driven CD only — no manual detectChanges().
    fixture.autoDetectChanges();
    await fixture.whenStable();

    // Not the empty-state.
    expect(html().querySelector('[data-testid="header-fields-unavailable"]')).toBeNull();

    // DECISIVE: the definition label reached the DOM; the old hardcoded label never could.
    expect(html().textContent).toContain('Nominal WT');
    expect(html().textContent).toContain('Nominal OD');
    expect(html().textContent).not.toContain('Nom. W.T');
    expect(html().textContent).not.toContain('Nom OD');

    // Values render by field key, incl. the generic object-list coercion for equipment.
    expect(
      html().querySelector('[data-testid="header-value-nomWT"]')?.textContent?.trim(),
    ).toBe('0.362');
    expect(
      html().querySelector('[data-testid="header-value-equipmentUsed"]')?.textContent,
    ).toContain('UT Gauge #UT-9');

    // Item-scope fields must NOT appear in the header view (scope filter is load-bearing).
    expect(html().querySelector('[data-testid="header-field-emiResult"]')).toBeNull();
    expect(html().textContent).not.toContain('EMI Result');
  });

  it('MUTATION GUARD: a definition with zero header-scope fields renders NOTHING — no header labels AND no false "not defined" alarm', async () => {
    const fixture = setup();
    const c = fixture.componentInstance;
    const html = () => fixture.nativeElement as HTMLElement;

    // Same definition, but every field is ITEM-scope — the header slice is empty. This is a
    // fully-defined template that simply has no header specs: NOT an error. It must render
    // nothing — never the "an administrator must define this template" alarm, which would
    // falsely accuse the admin (and is what a customer wrongly saw). Broken via input data
    // (not a test literal): if the render assertions were vacuous (labels present regardless
    // of the header path), this case would still show "Nominal WT" and go RED.
    const ITEM_ONLY_DEFINITION: TemplateFormDefinition = {
      ...DEFINITION,
      fields: DEFINITION.fields.map((f) => ({ ...f, scope: 'item' as const })),
    };

    c.definition = ITEM_ONLY_DEFINITION;
    c.data = DATA;
    fixture.autoDetectChanges();
    await fixture.whenStable();

    // A defined-but-header-less template is not an error: the alarm must be ABSENT…
    expect(
      html().querySelector('[data-testid="header-fields-unavailable"]'),
    ).toBeNull();
    // …and no header field labels/rows render either (the scope filter is load-bearing).
    expect(html().textContent).not.toContain('Nominal WT');
    expect(html().textContent).not.toContain('Nominal OD');
    expect(html().querySelector('[data-testid="header-field-nomWT"]')).toBeNull();
  });

  it('is definition-driven, not drill-pipe-shaped: a synthetic template renders labels found nowhere in drill pipe', async () => {
    const fixture = setup();
    const c = fixture.componentInstance;
    const html = () => fixture.nativeElement as HTMLElement;

    // Labels that appear in NO drill-pipe field ("Calibration Due", "Cert Number"): if the
    // view were drill-pipe-shaped it could never render them. Their presence proves the
    // header render is driven purely by the supplied definition — drill pipe is not the oracle.
    const SYNTHETIC_DEFINITION: TemplateFormDefinition = {
      templateKey: 'LIFTING_GEAR_INSPECTION',
      templateVersion: 3,
      sections: [],
      regions: [{ id: 'r1', marker: '{{tag}}' }],
      fields: [
        {
          key: 'calibrationDue',
          label: 'Calibration Due',
          type: 'date',
          required: false,
          scope: 'header',
        },
        {
          key: 'certNumber',
          label: 'Cert Number',
          type: 'text',
          required: false,
          scope: 'header',
        },
      ],
    };

    c.definition = SYNTHETIC_DEFINITION;
    c.data = { calibrationDue: '2027-01-31', certNumber: 'CERT-7788' };
    fixture.autoDetectChanges();
    await fixture.whenStable();

    expect(html().querySelector('[data-testid="header-fields-unavailable"]')).toBeNull();
    expect(html().textContent).toContain('Calibration Due');
    expect(html().textContent).toContain('Cert Number');
    expect(
      html().querySelector('[data-testid="header-value-certNumber"]')?.textContent?.trim(),
    ).toBe('CERT-7788');
    // And no drill-pipe field bled in from anywhere.
    expect(html().textContent).not.toContain('Nominal WT');
    expect(html().textContent).not.toContain('Grade');
  });

  it('renders a roled header field as a read-only System row (badge + derived value), not a plain value row', async () => {
    const fixture = setup();
    const c = fixture.componentInstance;
    const html = () => fixture.nativeElement as HTMLElement;

    const ROLED_DEFINITION: TemplateFormDefinition = {
      templateKey: 'DRILL_PIPE_REPORT',
      templateVersion: 1,
      sections: [],
      regions: [{ id: 'r1', marker: '{{sn}}' }],
      fields: [
        { key: 'grade', label: 'Grade', type: 'text', required: false, scope: 'header' },
        { key: 'inspBy', label: 'Inspector', type: 'text', required: false, scope: 'header', role: 'inspector' },
      ],
    };

    c.definition = ROLED_DEFINITION;
    // A stale/user value in headerData must NOT be shown for a roled field — its value is
    // derived. displayValue would surface 'STALE'; the System row must show the derived one.
    c.data = { grade: 'S-135', inspBy: 'STALE' };
    c.systemValues = {
      inspector: {
        value: 'Ivy Inspector',
        pending: false,
        pendingLabel: 'Awaiting inspection',
        source: 'Set at inspection',
      },
    };
    fixture.autoDetectChanges();
    await fixture.whenStable();

    // The roled field renders the System row (not the plain header-value row) with the badge.
    expect(html().querySelector('[data-testid="system-field-inspBy"]')).not.toBeNull();
    expect(html().querySelector('[data-testid="header-value-inspBy"]')).toBeNull();
    expect(html().querySelector('[data-testid="system-badge-inspBy"]')?.textContent).toContain('System');
    // The DERIVED value shows; the stale headerData value never reaches the DOM.
    expect(html().querySelector('[data-testid="system-value-inspBy"]')?.textContent).toContain('Ivy Inspector');
    expect(html().textContent).not.toContain('STALE');
    // A role-less field still renders as a normal value row.
    expect(html().querySelector('[data-testid="header-value-grade"]')?.textContent?.trim()).toBe('S-135');
  });

  it('re-renders reactively when the definition input is re-pointed (driven change)', async () => {
    const fixture = setup();
    const c = fixture.componentInstance;
    const html = () => fixture.nativeElement as HTMLElement;

    // ARM 1: start with no usable definition → explicit empty-state, zero fields.
    c.definition = null;
    c.data = DATA;
    fixture.autoDetectChanges();
    await fixture.whenStable();
    expect(
      html().querySelector('[data-testid="header-fields-unavailable"]'),
    ).not.toBeNull();
    expect(html().querySelector('[data-testid="header-field-grade"]')).toBeNull();

    // ARM 2: re-point to a real definition → the scheduler must flush the new render.
    c.definition = DEFINITION;
    await fixture.whenStable();
    expect(html().querySelector('[data-testid="header-fields-unavailable"]')).toBeNull();
    expect(html().querySelector('[data-testid="header-field-grade"]')).not.toBeNull();
    expect(html().textContent).toContain('Nominal WT');
  });
});
