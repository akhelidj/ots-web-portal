/**
 * Phase D flat step 4 — the describe-screen layout toggle (flat vs region), DOM-level,
 * now as a STEPPED WIZARD.
 *
 * Step 4 makes flat authoring user-facing. This RENDERS the component and drives it the
 * way a user does — through DOM events, INCLUDING walking the wizard with real "Next"
 * clicks (the zoneless scheduler only re-renders on those or on signal writes; a manual
 * detectChanges() would mask real wiring). It asserts the SAME behaviours the pre-wizard
 * spec did, expressed through the wizard's per-step structure:
 *
 *   - FLAT mode (toggle off, the default): 3 steps (no Region step); on the Describe step
 *     the marker/region declaration and the per-row `scope` control are ABSENT; ops just
 *     describes fields. `buildDto()` omits `region` → the body the server builds as
 *     `regions: []`.
 *   - REGION mode (toggle on): 4 steps; the marker control appears on the Region step and
 *     the per-row `scope` control on the Describe step.
 *   - Step-gating (the wizard's expression of the old Save-disable): the client cannot
 *     advance from a step it can already see is invalid — an empty label blocks leaving
 *     Describe (either mode), an unset marker blocks leaving Region (region mode only). A
 *     flat template with all labels and NO marker DOES reach Review with Save enabled
 *     (marker is irrelevant when flat).
 *
 * These fail if the old always-enabled binding returns, if flat mode still shows the
 * marker/scope controls, or if the gate stops blocking an invalid step — the same
 * non-vacuity anchors as before, re-pointed at the wizard.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TemplateDefineComponent } from './template-define.component';
import {
  AdminTemplatesService,
  ExtractedToken,
} from '@portal/features/templates/services/admin-templates.service';

/** A two-token workbook — no drill-pipe shape assumed. */
const TOKENS: ExtractedToken[] = [
  { token: '{{poNumber}}', cell: 'B2', row: 2 },
  { token: '{{casingWeight}}', cell: 'D4', row: 4 },
];

describe('TemplateDefineComponent — flat/region layout wizard (step 4)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function setup() {
    const getTokens = jest.fn().mockResolvedValue(TOKENS);
    TestBed.configureTestingModule({
      imports: [TemplateDefineComponent],
      providers: [
        {
          provide: AdminTemplatesService,
          useValue: { getTokens, defineTemplate: jest.fn() },
        },
        { provide: Router, useValue: { navigate: jest.fn() } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 't1' } } },
        },
      ],
    });
    return TestBed.createComponent(TemplateDefineComponent);
  }

  /**
   * Render + settle the async token load using ONLY the zoneless scheduler (no manual
   * detectChanges) — the same proven path as template-define.render.spec.ts. State changes
   * afterwards are driven through real DOM events so the scheduler re-renders on its own.
   * Lands on the wizard's first step (Layout).
   */
  async function render() {
    const fixture = setup();
    fixture.componentInstance.templateId = 't1';
    fixture.autoDetectChanges();
    await fixture.componentInstance.load();
    await fixture.whenStable();
    return fixture;
  }

  const el = (f: ComponentFixture<TemplateDefineComponent>) =>
    f.nativeElement as HTMLElement;
  const q = (f: ComponentFixture<TemplateDefineComponent>, sel: string) =>
    el(f).querySelector(sel);
  /** The single primary action button — "Next" on every step except the last, "Save" on
   *  the Review step. (The wizard renders exactly one `.btn-primary` at a time.) */
  const primaryBtn = (f: ComponentFixture<TemplateDefineComponent>) =>
    el(f).querySelector('button.btn-primary') as HTMLButtonElement;
  const nextBtn = (f: ComponentFixture<TemplateDefineComponent>) =>
    el(f).querySelector('[data-testid="wizard-next"]') as HTMLButtonElement | null;

  /** Click "Next" and let the scheduler flush. A disabled Next dispatches no click (jsdom
   *  honours the disabled form-control rule), so this is a no-op on an invalid step. */
  async function clickNext(f: ComponentFixture<TemplateDefineComponent>) {
    nextBtn(f)?.click();
    await f.whenStable();
  }

  async function clickToggle(f: ComponentFixture<TemplateDefineComponent>) {
    (q(f, '[data-testid="has-repeating-rows"]') as HTMLInputElement).click();
    await f.whenStable();
  }
  async function typeLabel(
    f: ComponentFixture<TemplateDefineComponent>,
    token: string,
    value: string,
  ) {
    const input = q(f, `[data-testid="label-${token}"]`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await f.whenStable();
  }
  async function pickMarker(
    f: ComponentFixture<TemplateDefineComponent>,
    token: string,
  ) {
    const select = q(f, '#define-marker') as HTMLSelectElement;
    select.value = token;
    select.dispatchEvent(new Event('change'));
    await f.whenStable();
  }

  it('FLAT (default): 3 steps, no Region step; Describe has no marker/scope; buildDto omits region', async () => {
    const f = await render();

    expect(f.componentInstance.hasRepeatingRows()).toBe(false); // flat is the default
    // Flat → exactly three steps (Layout, Describe, Review); Region is omitted, not greyed.
    expect(f.componentInstance.visibleSteps().map((s) => s.key)).toEqual([
      'layout',
      'describe',
      'review',
    ]);
    expect(el(f).textContent).toContain('Step 1 of 3');

    // Walk to the Describe step.
    await clickNext(f);
    expect(el(f).textContent).toContain('Step 2 of 3 — Describe Fields');

    // The marker/region declaration never renders in flat mode (there is no Region step),
    // and no per-row scope control renders on Describe.
    expect(q(f, '#define-marker')).toBeNull();
    expect(q(f, '#define-region-id')).toBeNull();
    expect(q(f, '[data-testid="scope-{{poNumber}}"]')).toBeNull();

    // But the field-describe controls (label/type) DO render — ops still describes fields.
    expect(q(f, '[data-testid="label-{{poNumber}}"]')).not.toBeNull();
    expect(q(f, '[data-testid="type-{{poNumber}}"]')).not.toBeNull();

    // The assembled body carries NO region → the server builds `regions: []`.
    await typeLabel(f, '{{poNumber}}', 'PO Number');
    await typeLabel(f, '{{casingWeight}}', 'Casing Weight');
    expect(f.componentInstance.buildDto().region).toBeUndefined();
    expect(f.componentInstance.buildDto().fields.map((fl) => fl.token)).toEqual([
      '{{poNumber}}',
      '{{casingWeight}}',
    ]);
  });

  it('REGION (toggle on): 4 steps; marker appears on Region, scope on Describe', async () => {
    const f = await render();
    await clickToggle(f);

    // Region mode inserts the Region step → four steps.
    expect(f.componentInstance.visibleSteps().map((s) => s.key)).toEqual([
      'layout',
      'region',
      'describe',
      'review',
    ]);
    expect(el(f).textContent).toContain('Step 1 of 4');

    // Region step: the marker + region-id controls are present.
    await clickNext(f);
    expect(el(f).textContent).toContain('Step 2 of 4 — Region & Marker');
    expect(q(f, '#define-marker')).not.toBeNull();
    expect(q(f, '#define-region-id')).not.toBeNull();

    // Choose a marker (region id is prefilled 'serials') so the gate lets us continue to
    // Describe, where the per-row scope control now renders.
    await pickMarker(f, '{{poNumber}}');
    await clickNext(f);
    expect(el(f).textContent).toContain('Step 3 of 4 — Describe Fields');
    expect(q(f, '[data-testid="scope-{{poNumber}}"]')).not.toBeNull();
  });

  it('flat: an empty label BLOCKS leaving Describe (Next disabled, cannot save)', async () => {
    const f = await render();
    await clickNext(f); // → Describe
    await typeLabel(f, '{{poNumber}}', 'PO Number');
    // {{casingWeight}} left unlabelled → the client can already see the form is invalid.
    expect(nextBtn(f)!.disabled).toBe(true);
    expect(f.componentInstance.canSave()).toBe(false);
  });

  it('flat: all labels set and NO marker → reaches Review with Save ENABLED', async () => {
    const f = await render();
    await clickNext(f); // → Describe
    await typeLabel(f, '{{poNumber}}', 'PO Number');
    await typeLabel(f, '{{casingWeight}}', 'Casing Weight');
    // Describe is now valid → Next enabled; advancing lands on Review with Save enabled.
    expect(nextBtn(f)!.disabled).toBe(false);
    await clickNext(f); // → Review
    expect(el(f).textContent).toContain('Step 3 of 3 — Review & Save');
    // Flat: marker is irrelevant, so a missing marker must NOT block Save.
    expect(f.componentInstance.markerToken).toBe('');
    expect(primaryBtn(f).textContent).toContain('Save Definition');
    expect(primaryBtn(f).disabled).toBe(false);
  });

  it('region: an unset marker BLOCKS leaving Region, then choosing it UNBLOCKS', async () => {
    const f = await render();
    await clickToggle(f); // region mode
    await clickNext(f); // → Region
    // No repeating-row token chosen yet → cannot advance.
    expect(f.componentInstance.markerToken).toBe('');
    expect(nextBtn(f)!.disabled).toBe(true);

    // Choosing the marker (region id is prefilled 'serials') satisfies the client minimum.
    await pickMarker(f, '{{poNumber}}');
    expect(f.componentInstance.markerToken).toBe('{{poNumber}}');
    expect(nextBtn(f)!.disabled).toBe(false);
  });

  it('region: an empty label BLOCKS leaving Describe', async () => {
    const f = await render();
    await clickToggle(f); // region mode
    await clickNext(f); // → Region
    await pickMarker(f, '{{poNumber}}');
    await clickNext(f); // → Describe
    // The one described (non-marker) field, {{casingWeight}}, has no label → cannot advance.
    expect(el(f).textContent).toContain('Step 3 of 4 — Describe Fields');
    expect(nextBtn(f)!.disabled).toBe(true);
    expect(f.componentInstance.canSave()).toBe(false);
  });
});
