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
    // Undefined template: load() reads the definition first (null) → authoring flow.
    const getDefinition = jest.fn().mockResolvedValue({ definitionJson: null });
    TestBed.configureTestingModule({
      imports: [TemplateDefineComponent],
      providers: [
        {
          provide: AdminTemplatesService,
          useValue: { getTokens, getDefinition, defineTemplate: jest.fn() },
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

/**
 * Mandatory seven-role SAVE gate, DOM-level — the live-verify for Roles #1, driven through
 * real zoneless DOM events exactly as an author does. A workbook carrying a token for each of
 * the six header roles plus a serial marker: mapping ALL seven enables Save and, on click,
 * calls defineTemplate then routes to the list (saves + redirects); leaving ONE header role
 * unmapped renders the named "still unassigned" status and disables Save on Review.
 *
 * The role mandate is a SAVE invariant (canSave/submit), NOT a per-step Next gate — walking
 * past Metadata with a hole is deliberately allowed, so this spec proves the gate bites only
 * at Save, and names the exact missing role in the DOM.
 */
const ROLED_TOKENS: ExtractedToken[] = [
  { token: '{{sn}}', cell: 'A2', row: 2 }, // first → default serialNumber marker
  { token: '{{customer}}', cell: 'B1', row: 1 },
  { token: '{{reportNumber}}', cell: 'C1', row: 1 },
  { token: '{{poNumber}}', cell: 'D1', row: 1 },
  { token: '{{inspectedBy}}', cell: 'E1', row: 1 },
  { token: '{{approvedBy}}', cell: 'F1', row: 1 },
  { token: '{{reportDate}}', cell: 'G1', row: 1 },
];

/** token → the header role it must carry (label is free text). */
const HEADER_ROLE_BY_TOKEN: { token: string; label: string; role: string }[] = [
  { token: '{{customer}}', label: 'Customer', role: 'customer' },
  { token: '{{reportNumber}}', label: 'Report No', role: 'reportNumber' },
  { token: '{{poNumber}}', label: 'PO No', role: 'poNumber' },
  { token: '{{inspectedBy}}', label: 'Inspector', role: 'inspector' },
  { token: '{{approvedBy}}', label: 'Supervisor', role: 'supervisor' },
  { token: '{{reportDate}}', label: 'Date', role: 'inspectionDate' },
];

describe('TemplateDefineComponent — mandatory seven-role SAVE gate (live-verify)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function setup() {
    const getTokens = jest.fn().mockResolvedValue(ROLED_TOKENS);
    const getDefinition = jest.fn().mockResolvedValue({ definitionJson: null });
    const defineTemplate = jest.fn().mockResolvedValue({});
    const navigate = jest.fn();
    TestBed.configureTestingModule({
      imports: [TemplateDefineComponent],
      providers: [
        {
          provide: AdminTemplatesService,
          useValue: { getTokens, getDefinition, defineTemplate },
        },
        { provide: Router, useValue: { navigate } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 't1' } } },
        },
      ],
    });
    return { fixture: TestBed.createComponent(TemplateDefineComponent), defineTemplate, navigate };
  }

  const el = (f: ComponentFixture<TemplateDefineComponent>) =>
    f.nativeElement as HTMLElement;
  const q = (f: ComponentFixture<TemplateDefineComponent>, sel: string) =>
    el(f).querySelector(sel);
  const nextBtn = (f: ComponentFixture<TemplateDefineComponent>) =>
    el(f).querySelector('[data-testid="wizard-next"]') as HTMLButtonElement | null;
  const saveBtn = (f: ComponentFixture<TemplateDefineComponent>) =>
    [...el(f).querySelectorAll('button')].find((b) =>
      /Save Definition|Saving/.test(b.textContent ?? ''),
    ) as HTMLButtonElement | undefined;

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
  async function selectValue(
    f: ComponentFixture<TemplateDefineComponent>,
    sel: string,
    value: string,
  ) {
    const s = q(f, sel) as HTMLSelectElement;
    s.value = value;
    s.dispatchEvent(new Event('change'));
    await f.whenStable();
  }

  /** Include every header token, label it, and map its role — through real DOM events. */
  async function mapAllHeaderRoles(
    f: ComponentFixture<TemplateDefineComponent>,
    { skip }: { skip?: string } = {},
  ) {
    for (const { token, label, role } of HEADER_ROLE_BY_TOKEN) {
      await click(f, `[data-testid="header-include-${token}"]`);
      await typeInto(f, `[data-testid="header-label-${token}"]`, label);
      if (token !== skip) {
        await selectValue(f, `[data-testid="header-role-${token}"]`, role);
      }
    }
  }

  async function render() {
    const ctx = setup();
    ctx.fixture.componentInstance.templateId = 't1';
    ctx.fixture.autoDetectChanges();
    await ctx.fixture.componentInstance.load();
    await ctx.fixture.whenStable();
    return ctx;
  }

  it('all seven roles mapped → Save enabled → click saves and redirects to the list', async () => {
    const { fixture: f, defineTemplate, navigate } = await render();

    await clickNext(f); // → Metadata
    await mapAllHeaderRoles(f);
    expect(f.componentInstance.missingHeaderRoles()).toEqual([]);

    await clickNext(f); // → Serial ({{sn}} is the default serialNumber marker)
    await typeInto(f, '[data-testid="serial-label-{{sn}}"]', 'Serial Number');
    expect(f.componentInstance.serialStepValid()).toBe(true);

    await clickNext(f); // → Review
    expect(f.componentInstance.canSave()).toBe(true);
    expect(saveBtn(f)!.disabled).toBe(false);

    saveBtn(f)!.click();
    await f.whenStable();

    expect(defineTemplate).toHaveBeenCalledTimes(1);
    const [, dto] = defineTemplate.mock.calls[0];
    // Every header role rode through to the DTO, plus the serial marker.
    const rolesInDto = dto.fields
      .map((x: { role?: string }) => x.role)
      .filter(Boolean)
      .sort();
    expect(rolesInDto).toEqual(
      [
        'customer',
        'inspectionDate',
        'inspector',
        'poNumber',
        'reportNumber',
        'serialNumber',
        'supervisor',
      ].sort(),
    );
    expect(dto.region.marker).toBe('{{sn}}');
    expect(navigate).toHaveBeenCalled(); // redirected to the templates list
  });

  it('one header role left unmapped → status names it, Save stays blocked, no save fires', async () => {
    const { fixture: f, defineTemplate } = await render();

    await clickNext(f); // → Metadata
    await mapAllHeaderRoles(f, { skip: '{{poNumber}}' }); // poNumber included + labelled, role blank

    // Metadata step is NOT blocked (label-only) — the hole shows as an informational status.
    expect(f.componentInstance.headerStepValid()).toBe(true);
    expect(f.componentInstance.missingHeaderRoles()).toEqual(['poNumber']);
    expect(q(f, '[data-testid="missing-roles"]')?.textContent).toContain('PO number');

    await clickNext(f); // → Serial
    await typeInto(f, '[data-testid="serial-label-{{sn}}"]', 'Serial Number');
    await clickNext(f); // → Review

    // Save invariant bites here: button disabled, canSave false, nothing sent.
    expect(f.componentInstance.canSave()).toBe(false);
    expect(saveBtn(f)!.disabled).toBe(true);
    saveBtn(f)!.click();
    await f.whenStable();
    expect(defineTemplate).not.toHaveBeenCalled();
  });

  it('grandfathered role-less template loads read-only and shows the saved recap (no re-gate)', async () => {
    // A definition saved BEFORE roles existed: fields carry no `role`. The validator never runs
    // on read, so it must still open — as the read-only recap, never forced back through the gate.
    const legacyDef = {
      displayName: 'Legacy Casing Report',
      regions: [{ id: 'serials', chunkSize: null }],
      fields: [
        { key: 'sn', label: 'Serial', type: 'text', required: true, scope: 'item' },
        { key: 'wall', label: 'Wall', type: 'number', required: false, scope: 'item' },
      ],
      export: { global: [], regions: { serials: [{ token: '{{sn}}', source: 'rowSerial' }] } },
    };
    const getDefinition = jest.fn().mockResolvedValue({ definitionJson: legacyDef });
    TestBed.configureTestingModule({
      imports: [TemplateDefineComponent],
      providers: [
        {
          provide: AdminTemplatesService,
          useValue: { getTokens: jest.fn(), getDefinition, defineTemplate: jest.fn() },
        },
        { provide: Router, useValue: { navigate: jest.fn() } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 't1' } } },
        },
      ],
    });
    const f = TestBed.createComponent(TemplateDefineComponent);
    f.componentInstance.templateId = 't1';
    f.autoDetectChanges();
    await f.componentInstance.load();
    await f.whenStable();

    // Opens read-only — the recap, not the authoring wizard, and no save/next controls.
    expect(f.componentInstance.readOnly()).toBe(true);
    expect(el(f).querySelector('[data-testid="readonly-recap"]')).not.toBeNull();
    expect(el(f).textContent).toContain('Legacy Casing Report');
    expect(el(f).querySelector('[data-testid="wizard-next"]')).toBeNull();
    expect(saveBtn(f)).toBeUndefined();
  });
});
