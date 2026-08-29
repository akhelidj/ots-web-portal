/**
 * The Define-Template wizard, DOM-level — step gating + derived scope, driven the way a
 * user does (through real DOM events, INCLUDING walking the wizard with "Next" clicks). The
 * zoneless scheduler only re-renders on those or on signal writes; a manual detectChanges()
 * would mask real wiring, so this spec uses autoDetectChanges() + whenStable() only.
 *
 * Behaviours asserted (the new four-step shape — Detect → Header → Serial → Review):
 *   - Always FOUR steps; Detect is read-only and never blocks Next.
 *   - Scope is DERIVED: a token checked on Header exports `header`; everything else is a
 *     pre-checked serial (`item`) field.
 *   - Serial gating: a serial field with no label blocks leaving Serial; removing the
 *     serialNumber marker blocks it too.
 *   - The bulk "select-all" and role controls behave as the reshape specifies.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TemplateDefineComponent } from './template-define.component';
import {
  AdminTemplatesService,
  ExtractedToken,
} from '@portal/features/templates/services/admin-templates.service';

/** A three-token workbook — no drill-pipe shape assumed. */
const TOKENS: ExtractedToken[] = [
  { token: '{{sn}}', cell: 'A2', row: 2 },
  { token: '{{poNumber}}', cell: 'B1', row: 1 },
  { token: '{{casingWeight}}', cell: 'D4', row: 4 },
];

describe('TemplateDefineComponent — wizard step gating + derived scope', () => {
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
  const nextBtn = (f: ComponentFixture<TemplateDefineComponent>) =>
    el(f).querySelector('[data-testid="wizard-next"]') as HTMLButtonElement | null;

  async function clickNext(f: ComponentFixture<TemplateDefineComponent>) {
    nextBtn(f)?.click();
    await f.whenStable();
  }
  async function click(f: ComponentFixture<TemplateDefineComponent>, sel: string) {
    (q(f, sel) as HTMLElement).click();
    await f.whenStable();
  }
  async function typeInto(
    f: ComponentFixture<TemplateDefineComponent>,
    sel: string,
    value: string,
  ) {
    const input = q(f, sel) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await f.whenStable();
  }

  it('always has four steps; Detect is read-only and Next advances to Header', async () => {
    const f = await render();
    expect(f.componentInstance.steps.map((s) => s.key)).toEqual([
      'detect',
      'header',
      'serial',
      'review',
    ]);
    expect(el(f).textContent).toContain('Step 1 of 4 — Detect Tokens');
    // Detect has no editable controls; Next is enabled straight away.
    expect(nextBtn(f)!.disabled).toBe(false);
    await clickNext(f);
    expect(el(f).textContent).toContain('Step 2 of 4 — Metadata');
  });

  it('derived scope: a token checked on Header leaves the serial set; the rest are pre-checked serials', async () => {
    const f = await render();

    // Every token starts as a pre-checked serial candidate.
    expect(f.componentInstance.serialCandidateRows().map((r) => r.token)).toEqual(
      TOKENS.map((t) => t.token),
    );
    expect(f.componentInstance.serialCandidateRows().every((r) => r.serial)).toBe(true);

    // Claim {{poNumber}} on the Metadata step.
    await clickNext(f); // → Header
    await click(f, '[data-testid="header-include-{{poNumber}}"]');

    // It is now a header field and no longer a serial candidate.
    expect(f.componentInstance.headerRows().map((r) => r.token)).toEqual(['{{poNumber}}']);
    expect(
      f.componentInstance.serialCandidateRows().map((r) => r.token),
    ).not.toContain('{{poNumber}}');
  });

  it('Serial gating: an empty label BLOCKS leaving Serial; labelling all UNBLOCKS', async () => {
    const f = await render();
    await clickNext(f); // → Header (claim nothing → all serial)
    await clickNext(f); // → Serial
    expect(el(f).textContent).toContain('Step 3 of 4 — Serial');

    // {{sn}} is the default serialNumber marker; the other serial fields are unlabelled.
    expect(nextBtn(f)!.disabled).toBe(true);

    // Label every included serial field (marker included — a roled row keeps its label).
    await typeInto(f, '[data-testid="serial-label-{{sn}}"]', 'Serial Number');
    await typeInto(f, '[data-testid="serial-label-{{poNumber}}"]', 'PO Number');
    await typeInto(f, '[data-testid="serial-label-{{casingWeight}}"]', 'Casing Weight');
    expect(f.componentInstance.serialStepValid()).toBe(true);
    expect(nextBtn(f)!.disabled).toBe(false);
  });

  it('Serial gating: removing the serialNumber marker BLOCKS leaving Serial', async () => {
    const f = await render();
    await clickNext(f); // → Header
    await clickNext(f); // → Serial
    // Label everything so only the marker rule can be at fault.
    await typeInto(f, '[data-testid="serial-label-{{sn}}"]', 'Serial Number');
    await typeInto(f, '[data-testid="serial-label-{{poNumber}}"]', 'PO Number');
    await typeInto(f, '[data-testid="serial-label-{{casingWeight}}"]', 'Casing Weight');
    expect(nextBtn(f)!.disabled).toBe(false);

    // Clear the marker via the role select → Serial step invalid again.
    const roleSelect = q(f, '[data-testid="serial-role-{{sn}}"]') as HTMLSelectElement;
    roleSelect.value = '';
    roleSelect.dispatchEvent(new Event('change'));
    await f.whenStable();
    expect(f.componentInstance.serialMarkerRow()).toBeUndefined();
    expect(nextBtn(f)!.disabled).toBe(true);
  });

  it('select-all toggles inclusion for every serial candidate', async () => {
    const f = await render();
    await clickNext(f); // → Header
    await clickNext(f); // → Serial

    expect(f.componentInstance.allSerialSelected()).toBe(true);
    await click(f, '[data-testid="serial-select-all"]'); // uncheck all
    expect(f.componentInstance.serialRows()).toHaveLength(0);
    await click(f, '[data-testid="serial-select-all"]'); // re-check all
    expect(f.componentInstance.allSerialSelected()).toBe(true);
  });
});
