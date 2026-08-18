/**
 * Phase D step 2b — the describe screen (deliverable 1).
 *
 * Proves the component, given the REAL fixture's tokens, ASSEMBLES a DefineTemplateDto
 * whose shape the 2a server gate accepts, and SURFACES a server rejection verbatim
 * (rendering the gate's per-check reason — no client reimplementation of the checks).
 *
 * The valid DTO built here is byte-identical to the one the API-side gate proof
 * (`definition-ui-contract.spec.ts`) runs through the REAL builder + validator against
 * the REAL fixture workbook. The two specs meet at this DefineTemplateDto contract:
 * this side proves the UI emits it; that side proves the gate accepts it.
 */
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TemplateDefineComponent } from './template-define.component';
import {
  AdminTemplatesService,
  DefineTemplateDto,
  ExtractedToken,
} from '@portal/features/templates/services/admin-templates.service';

/** The fixture's tokens (a superset of what we describe — `{{grade}}` is left ignored). */
const FIXTURE_TOKENS: ExtractedToken[] = [
  { token: '{{sn}}', cell: 'A2', row: 2 },
  { token: '{{poNumber}}', cell: 'B1', row: 1 },
  { token: '{{reportDate}}', cell: 'C1', row: 1 },
  { token: '{{b_od}}', cell: 'D2', row: 2 },
  { token: '{{emi}}', cell: 'E2', row: 2 },
  { token: '{{grade}}', cell: 'F1', row: 1 },
];

/** The exact body the gate proof asserts is accepted. Keep the two in lockstep. */
const EXPECTED_DTO: DefineTemplateDto = {
  displayName: 'Casing Report',
  region: { id: 'serials', marker: '{{sn}}', label: 'Inspected Serials' },
  fields: [
    { token: '{{poNumber}}', label: 'PO Number', type: 'text', required: false, scope: 'header' },
    { token: '{{reportDate}}', label: 'Report Date', type: 'date', required: false, scope: 'header' },
    { token: '{{b_od}}', label: 'Box Min OD', type: 'text', required: true, scope: 'item', section: 'Box' },
    {
      token: '{{emi}}',
      label: 'EMI Result',
      type: 'select',
      required: true,
      scope: 'item',
      section: 'Body',
      options: ['PASS', 'REWORK', 'SCRAP', 'HOLD'],
    },
  ],
};

describe('TemplateDefineComponent — describe screen', () => {
  let getTokens: jest.Mock;
  let defineTemplate: jest.Mock;

  function make(): TemplateDefineComponent {
    getTokens = jest.fn().mockResolvedValue(FIXTURE_TOKENS);
    defineTemplate = jest.fn().mockResolvedValue({ id: 't1' });

    TestBed.configureTestingModule({
      imports: [TemplateDefineComponent],
      providers: [
        { provide: AdminTemplatesService, useValue: { getTokens, defineTemplate } },
        { provide: Router, useValue: { navigate: jest.fn() } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 't1' } } },
        },
      ],
    });
    return TestBed.createComponent(TemplateDefineComponent).componentInstance;
  }

  /** Drive the describe form to the valid EXPECTED_DTO state. */
  async function describeValid(c: TemplateDefineComponent): Promise<void> {
    c.templateId = 't1';
    await c.load();
    c.displayName = 'Casing Report';
    c.regionId = 'serials';
    c.regionLabel = 'Inspected Serials';
    c.markerToken = '{{sn}}';

    const set = (token: string, patch: Partial<ReturnType<typeof c.rows>[number]>) =>
      Object.assign(c.rows().find((r) => r.token === token)!, patch);

    set('{{poNumber}}', { label: 'PO Number', type: 'text', scope: 'header' });
    set('{{reportDate}}', { label: 'Report Date', type: 'date', scope: 'header' });
    set('{{b_od}}', { label: 'Box Min OD', type: 'text', required: true, scope: 'item', section: 'Box' });
    set('{{emi}}', {
      label: 'EMI Result',
      type: 'select',
      required: true,
      scope: 'item',
      section: 'Body',
      optionsText: 'PASS, REWORK, SCRAP, HOLD',
    });
    set('{{grade}}', { include: false }); // ignored → must not appear in the DTO
  }

  afterEach(() => TestBed.resetTestingModule());

  it('loads the workbook tokens into one describe-row each', async () => {
    const c = make();
    c.templateId = 't1';
    await c.load();
    expect(getTokens).toHaveBeenCalledWith('t1');
    expect(c.rows().map((r) => r.token)).toEqual(FIXTURE_TOKENS.map((t) => t.token));
  });

  it('assembles the gate-accepted DTO and submits it on success', async () => {
    const c = make();
    await describeValid(c);

    // The assembled body matches the shape the server gate accepts (excludes the marker
    // and the ignored token; carries options only on the select).
    expect(c.buildDto()).toEqual(EXPECTED_DTO);

    await c.submit();
    expect(defineTemplate).toHaveBeenCalledWith('t1', EXPECTED_DTO);
    expect(c.success()).toBe(true);
    expect(c.submitError()).toBe('');
  });

  it('surfaces the server’s per-check rejection inline; nothing marked written', async () => {
    const c = make();
    await describeValid(c);
    // Server rejects (e.g. the gate found a select with no options). The UI renders the
    // server's reason — it does NOT reimplement the check.
    defineTemplate.mockRejectedValueOnce({
      error: {
        code: 'DEFINITION_INVALID',
        check: 'select-options',
        message: 'Select field "emi" must declare non-empty options.',
      },
    });

    await c.submit();
    expect(c.failedCheck()).toBe('select-options');
    expect(c.submitError()).toContain('must declare non-empty options');
    expect(c.success()).toBe(false);
  });

  it('nicety: refuses to submit an included field with an empty label', async () => {
    const c = make();
    await describeValid(c);
    c.rows().find((r) => r.token === '{{b_od}}')!.label = '   ';

    await c.submit();
    expect(defineTemplate).not.toHaveBeenCalled();
    expect(c.submitError()).toContain('label');
  });

  it('nicety: refuses to submit without a chosen serial marker', async () => {
    const c = make();
    await describeValid(c);
    c.markerToken = '';

    await c.submit();
    expect(defineTemplate).not.toHaveBeenCalled();
    expect(c.submitError()).toContain('marker');
  });
});
