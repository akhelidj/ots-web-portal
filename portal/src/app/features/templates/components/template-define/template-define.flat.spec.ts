/**
 * Phase D flat step 4 — the describe-screen layout toggle (flat vs region), DOM-level.
 *
 * Step 4 makes flat authoring user-facing. This RENDERS the component and drives it the
 * way a user does — through DOM events (the zoneless scheduler only re-renders on those or
 * on signal writes; a manual detectChanges() would mask real wiring). It asserts:
 *
 *   - FLAT mode (toggle off, the default): the marker/region declaration and the per-row
 *     `scope` control are ABSENT; ops just describes fields. `buildDto()` omits `region`
 *     → the body the server builds as `regions: []`.
 *   - REGION mode (toggle on): the marker + scope controls are PRESENT (today's screen).
 *   - Save-disable: the button is disabled whenever the client can already see the form is
 *     invalid — an empty label (either mode), or an unset marker (region mode only). In
 *     flat mode a missing marker must NOT block Save (marker is irrelevant when flat).
 *
 * The Save-disable tests fail if the old always-enabled `[disabled]="isSubmitting()"`
 * binding returns; the scope/marker-absent tests fail if flat mode still shows those
 * controls. Both are the non-vacuity anchors for the mutation guards.
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

describe('TemplateDefineComponent — flat/region layout toggle (step 4)', () => {
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
  const saveBtn = (f: ComponentFixture<TemplateDefineComponent>) =>
    el(f).querySelector('button.btn-primary') as HTMLButtonElement;

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

  it('FLAT (default): no marker or scope controls; buildDto omits region', async () => {
    const f = await render();

    expect(f.componentInstance.hasRepeatingRows).toBe(false); // flat is the default

    // The whole region/marker declaration is gone, and no per-row scope control renders.
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

  it('REGION (toggle on): marker + scope controls appear', async () => {
    const f = await render();
    await clickToggle(f);

    expect(q(f, '#define-marker')).not.toBeNull();
    expect(q(f, '#define-region-id')).not.toBeNull();
    expect(q(f, '[data-testid="scope-{{poNumber}}"]')).not.toBeNull();
  });

  it('Save is DISABLED with an empty label (flat mode)', async () => {
    const f = await render();
    await typeLabel(f, '{{poNumber}}', 'PO Number');
    // {{casingWeight}} left unlabelled → the client can already see the form is invalid.
    expect(saveBtn(f).disabled).toBe(true);
  });

  it('Save is ENABLED in flat mode with all labels set and NO marker', async () => {
    const f = await render();
    await typeLabel(f, '{{poNumber}}', 'PO Number');
    await typeLabel(f, '{{casingWeight}}', 'Casing Weight');
    // Flat: marker is irrelevant, so a missing marker must NOT block Save.
    expect(f.componentInstance.markerToken).toBe('');
    expect(saveBtn(f).disabled).toBe(false);
  });

  it('Save is DISABLED in region mode while the marker is unset, then ENABLES', async () => {
    const f = await render();
    await clickToggle(f); // region mode
    await typeLabel(f, '{{poNumber}}', 'PO Number');
    await typeLabel(f, '{{casingWeight}}', 'Casing Weight');
    // No repeating-row token chosen yet → disabled.
    expect(f.componentInstance.markerToken).toBe('');
    expect(saveBtn(f).disabled).toBe(true);

    // Choosing the marker (region id is prefilled 'serials') satisfies the client minimum.
    await pickMarker(f, '{{poNumber}}');
    expect(f.componentInstance.markerToken).toBe('{{poNumber}}');
    expect(saveBtn(f).disabled).toBe(false);
  });

  it('Save is DISABLED with an empty label (region mode)', async () => {
    const f = await render();
    await clickToggle(f); // region mode
    await pickMarker(f, '{{poNumber}}');
    // The one described (non-marker) field, {{casingWeight}}, has no label → disabled.
    expect(saveBtn(f).disabled).toBe(true);
  });
});
