/**
 * The Define-Template page in READ-ONLY recap mode (#6) — DOM-level, driven the way the app
 * loads it (through the real zoneless scheduler: autoDetectChanges + whenStable, no manual
 * detectChanges).
 *
 * A template that already carries a saved `definitionJson` opens straight to a read-only
 * recap hydrated from what was SAVED — never re-inferred from the workbook's tokens — with no
 * route back into the authoring steps. Behaviours asserted:
 *   - Defined detection: a non-empty stored `fields[]` flips `readOnly` and the page skips the
 *     token fetch entirely (fidelity: show the definition, not the current workbook).
 *   - Hydration fidelity: display name, header/serial split by scope, the serial marker's
 *     EXACT token (from the stored export), and the rework rule all reflect the stored blob.
 *   - Hard block: no progress rail, no Next, no Save in the DOM; `submit()` is inert.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TemplateDefineComponent } from './template-define.component';
import {
  AdminTemplatesService,
  StoredDefinition,
} from '@portal/features/templates/services/admin-templates.service';

/** A stored definition as the API's builder writes it: two-token header + serial split,
 *  the serial marker's exact token in export.regions (source `rowSerial`), one rework rule. */
const STORED: StoredDefinition = {
  displayName: 'Casing Report',
  regions: [{ id: 'serials', label: 'Serials', chunkSize: null }],
  fields: [
    { key: 'poNumber', label: 'PO Number', type: 'text', required: false, scope: 'header' },
    {
      key: 'sn',
      label: 'Serial Number',
      type: 'text',
      required: false,
      scope: 'item',
      role: 'serialNumber',
    },
    {
      key: 'emi',
      label: 'EMI Result',
      type: 'select',
      required: true,
      scope: 'item',
      section: 'Body',
      options: ['PASS', 'REWORK', 'SCRAP', 'HOLD'],
    },
  ],
  export: {
    global: [{ token: '{{poNumber}}', field: 'poNumber' }],
    regions: {
      serials: [
        { token: '{{sn}}', source: 'rowSerial' },
        { token: '{{emi}}', field: 'emi' },
      ],
    },
  },
  rules: [
    {
      when: { field: 'emi', op: 'eq', value: 'REWORK' },
      then: {
        action: 'upsertChildReport',
        childType: 'REWORK',
        membership: 'allItemsMatching',
        reportNumberSuffix: '_rw',
      },
    },
  ] as unknown[],
};

describe('TemplateDefineComponent — read-only recap for a defined template', () => {
  let getTokens: jest.Mock;
  let getDefinition: jest.Mock;
  let defineTemplate: jest.Mock;

  afterEach(() => TestBed.resetTestingModule());

  function setup(definitionJson: StoredDefinition | null) {
    getTokens = jest.fn().mockResolvedValue([]);
    getDefinition = jest.fn().mockResolvedValue({ definitionJson });
    defineTemplate = jest.fn().mockResolvedValue({ id: 't1' });
    TestBed.configureTestingModule({
      imports: [TemplateDefineComponent],
      providers: [
        {
          provide: AdminTemplatesService,
          useValue: { getTokens, getDefinition, defineTemplate },
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

  async function render(definitionJson: StoredDefinition | null) {
    const fixture = setup(definitionJson);
    fixture.componentInstance.templateId = 't1';
    fixture.autoDetectChanges();
    await fixture.componentInstance.load();
    await fixture.whenStable();
    return fixture;
  }

  const text = (f: ComponentFixture<TemplateDefineComponent>) =>
    (f.nativeElement as HTMLElement).textContent ?? '';
  const q = (f: ComponentFixture<TemplateDefineComponent>, sel: string) =>
    (f.nativeElement as HTMLElement).querySelector(sel);

  it('detects the defined state from the stored fields and skips the token fetch', async () => {
    const f = await render(STORED);
    expect(getDefinition).toHaveBeenCalledWith('t1');
    expect(f.componentInstance.readOnly()).toBe(true);
    // Fidelity: a defined template hydrates from the definition, never the workbook tokens.
    expect(getTokens).not.toHaveBeenCalled();
  });

  it('hydrates the recap from the stored definition — name, scope split, exact marker, rework', async () => {
    const f = await render(STORED);
    const c = f.componentInstance;

    expect(c.displayName).toBe('Casing Report');
    expect(c.headerRows().map((r) => r.token)).toEqual(['{{poNumber}}']);
    expect(c.serialRows().map((r) => r.token)).toEqual(['{{sn}}', '{{emi}}']);
    // The marker's exact token comes from the stored export (rowSerial), not a re-inference.
    expect(c.serialMarkerRow()?.token).toBe('{{sn}}');
    // A select field keeps its options; a sectioned field keeps its section.
    expect(c.serialRows().find((r) => r.token === '{{emi}}')?.optionsText).toBe(
      'PASS, REWORK, SCRAP, HOLD',
    );

    // Rework rule read back from rules[0].
    expect(c.reworkEnabled).toBe(true);
    expect(c.reworkField).toBe('emi');
    expect(c.reworkEquals).toBe('REWORK');
    expect(c.reworkChildType).toBe('REWORK');
    expect(c.reworkSuffix).toBe('_rw');

    // …and it renders in the DOM recap.
    expect(text(f)).toContain('Casing Report');
    expect(text(f)).toContain('EMI Result');
    expect(text(f)).toContain('{{sn}}');
  });

  it('hard-blocks re-definition: no progress rail, no Next, no Save; submit() is inert', async () => {
    const f = await render(STORED);

    expect(q(f, '[data-testid="readonly-recap"]')).not.toBeNull();
    // None of the authoring affordances exist in the DOM.
    expect(q(f, '[data-testid="wizard-next"]')).toBeNull();
    expect(text(f)).not.toContain('Step 1 of 4');
    expect(text(f)).not.toContain('Save Definition');

    // Even a direct call cannot save from read-only mode.
    await f.componentInstance.submit();
    expect(defineTemplate).not.toHaveBeenCalled();
  });

  it('an empty/garbled definition ({} with no fields) is treated as UNDEFINED → authoring', async () => {
    const f = await render({ fields: [] } as unknown as StoredDefinition);
    expect(f.componentInstance.readOnly()).toBe(false);
    // Falls through to the token-driven authoring flow.
    expect(getTokens).toHaveBeenCalledWith('t1');
    expect(q(f, '[data-testid="readonly-recap"]')).toBeNull();
  });
});
