/**
 * The Define-Template wizard (Detect → Header → Serial → Review) — assembly + submit.
 *
 * Proves the component, given the REAL fixture's tokens, ASSEMBLES a DefineTemplateDto
 * whose shape the server gate accepts, and SURFACES a server rejection verbatim (rendering
 * the gate's per-check reason — no client reimplementation of the checks).
 *
 * The valid DTO built here is byte-identical to the one the API-side gate proof
 * (`definition-ui-contract.spec.ts`) runs through the REAL builder + validator against the
 * REAL fixture workbook. The two specs meet at this DefineTemplateDto contract: this side
 * proves the UI emits it; that side proves the gate accepts it.
 */
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TemplateDefineComponent, DescribeRow } from './template-define.component';
import {
  AdminTemplatesService,
  DefineTemplateDto,
  ExtractedToken,
} from '@portal/features/templates/services/admin-templates.service';

/**
 * The fixture's tokens. `{{sn}}` is first so the default serialNumber marker lands on it;
 * the six header-role tokens follow (so `headerRows()` emits them in that order), then the
 * two plain serial fields, then a stray `{{grade}}` we leave out of the description.
 */
const FIXTURE_TOKENS: ExtractedToken[] = [
  { token: '{{sn}}', cell: 'A2', row: 2 },
  { token: '{{customer}}', cell: 'B1', row: 1 },
  { token: '{{reportNumber}}', cell: 'C1', row: 1 },
  { token: '{{poNumber}}', cell: 'D1', row: 1 },
  { token: '{{inspectedBy}}', cell: 'E1', row: 1 },
  { token: '{{approvedBy}}', cell: 'F1', row: 1 },
  { token: '{{reportDate}}', cell: 'G1', row: 1 },
  { token: '{{b_od}}', cell: 'D2', row: 2 },
  { token: '{{emi}}', cell: 'E2', row: 2 },
  { token: '{{grade}}', cell: 'H1', row: 1 },
];

/**
 * The exact body the gate proof asserts is accepted (byte-identical to the API-side
 * `definition-ui-contract.spec.ts` `uiDto`). Keep the two in lockstep. Every template is a
 * serial region now: `region` is always present, scope is DERIVED (Header step → `header`,
 * Serial step → `item`), and the serial's own token carries the `serialNumber` role and is
 * echoed as `region.marker`. All SIX header roles are mapped (the mandatory gate) plus the
 * item serialNumber. Field order = header rows first, then serial rows in row order.
 */
const EXPECTED_DTO: DefineTemplateDto = {
  displayName: 'Casing Report',
  fields: [
    { token: '{{customer}}', label: 'Customer', type: 'text', required: false, scope: 'header', role: 'customer' },
    { token: '{{reportNumber}}', label: 'Report Number', type: 'text', required: false, scope: 'header', role: 'reportNumber' },
    { token: '{{poNumber}}', label: 'PO Number', type: 'text', required: false, scope: 'header', role: 'poNumber' },
    { token: '{{inspectedBy}}', label: 'Inspector', type: 'text', required: false, scope: 'header', role: 'inspector' },
    { token: '{{approvedBy}}', label: 'Supervisor', type: 'text', required: false, scope: 'header', role: 'supervisor' },
    { token: '{{reportDate}}', label: 'Report Date', type: 'date', required: false, scope: 'header', role: 'inspectionDate' },
    { token: '{{sn}}', label: 'Serial Number', type: 'text', required: false, scope: 'item', role: 'serialNumber' },
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
  region: { id: 'serials', marker: '{{sn}}' },
};

describe('TemplateDefineComponent — assembly + submit', () => {
  let getTokens: jest.Mock;
  let getDefinition: jest.Mock;
  let defineTemplate: jest.Mock;

  function make(): TemplateDefineComponent {
    getTokens = jest.fn().mockResolvedValue(FIXTURE_TOKENS);
    // An UNDEFINED template — load() reads the definition first, sees null, and runs the
    // full authoring flow (these specs' subject).
    getDefinition = jest.fn().mockResolvedValue({ definitionJson: null });
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
    return TestBed.createComponent(TemplateDefineComponent).componentInstance;
  }

  const set = (
    c: TemplateDefineComponent,
    token: string,
    patch: Partial<DescribeRow>,
  ) => Object.assign(c.rows().find((r) => r.token === token)!, patch);

  /** Drive the wizard state to the valid EXPECTED_DTO. */
  async function describeValid(c: TemplateDefineComponent): Promise<void> {
    c.templateId = 't1';
    await c.load();
    c.displayName = 'Casing Report';

    // Header claims the six mandatory-role tokens (scope derived from inclusion); every one
    // of the six system header roles is mapped, so the mandatory gate is satisfied.
    set(c, '{{customer}}', { header: true, serial: false, label: 'Customer', type: 'text', role: 'customer' });
    set(c, '{{reportNumber}}', { header: true, serial: false, label: 'Report Number', type: 'text', role: 'reportNumber' });
    set(c, '{{poNumber}}', { header: true, serial: false, label: 'PO Number', type: 'text', role: 'poNumber' });
    set(c, '{{inspectedBy}}', { header: true, serial: false, label: 'Inspector', type: 'text', role: 'inspector' });
    set(c, '{{approvedBy}}', { header: true, serial: false, label: 'Supervisor', type: 'text', role: 'supervisor' });
    set(c, '{{reportDate}}', { header: true, serial: false, label: 'Report Date', type: 'date', role: 'inspectionDate' });

    // Serial fields — {{sn}} is the default serialNumber marker (rows[0]); the rest describe.
    set(c, '{{sn}}', { label: 'Serial Number' });
    set(c, '{{b_od}}', { label: 'Box Min OD', required: true, section: 'Box' });
    set(c, '{{emi}}', {
      label: 'EMI Result',
      type: 'select',
      required: true,
      section: 'Body',
      optionsText: 'PASS, REWORK, SCRAP, HOLD',
    });
    // A stray token, unchecked on the Serial step → excluded from the DTO.
    set(c, '{{grade}}', { serial: false });
  }

  afterEach(() => TestBed.resetTestingModule());

  it('loads the workbook tokens into one describe-row each (keeping the detected row)', async () => {
    const c = make();
    c.templateId = 't1';
    await c.load();
    expect(getTokens).toHaveBeenCalledWith('t1');
    expect(c.rows().map((r) => r.token)).toEqual(FIXTURE_TOKENS.map((t) => t.token));
    // The detected workbook row is KEPT in state (was dropped before), not rendered.
    expect(c.rows().map((r) => r.row)).toEqual(FIXTURE_TOKENS.map((t) => t.row));
  });

  it('pre-checks every token as a serial candidate and defaults the first as serialNumber', async () => {
    const c = make();
    c.templateId = 't1';
    await c.load();
    // All serial candidates arrive pre-checked (ops unchecks strays).
    expect(c.serialCandidateRows().every((r) => r.serial)).toBe(true);
    expect(c.serialCandidateRows()).toHaveLength(FIXTURE_TOKENS.length);
    // The first token is the default serialNumber marker — visible/changeable, not silent.
    expect(c.serialMarkerRow()?.token).toBe('{{sn}}');
  });

  it('assembles the gate-accepted DTO (derived scope, serialNumber → marker) and submits it', async () => {
    const c = make();
    await describeValid(c);

    expect(c.buildDto()).toEqual(EXPECTED_DTO);

    await c.submit();
    expect(defineTemplate).toHaveBeenCalledWith('t1', EXPECTED_DTO);
    expect(c.success()).toBe(true);
    expect(c.submitError()).toBe('');
    // On success the wizard leaves the Review step and returns to the templates list
    // (the save signal is a toast on that list, not a lingering in-wizard banner).
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/admin/templates']);
  });

  it('surfaces the server’s per-check rejection inline; nothing marked written', async () => {
    const c = make();
    await describeValid(c);
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
    set(c, '{{b_od}}', { label: '   ' });

    await c.submit();
    expect(defineTemplate).not.toHaveBeenCalled();
    expect(c.submitError()).toContain('label');
  });

  it('nicety: refuses to submit without exactly one serialNumber marker', async () => {
    const c = make();
    await describeValid(c);
    set(c, '{{sn}}', { role: '' }); // no marker

    await c.submit();
    expect(defineTemplate).not.toHaveBeenCalled();
    expect(c.submitError()).toContain('Serial Number');
  });

  it('mandatory gate: blocks Save until every one of the six header roles is mapped (names the gap)', async () => {
    const c = make();
    await describeValid(c);
    // A fully-described definition clears the gate…
    expect(c.missingHeaderRoles()).toEqual([]);
    expect(c.canSave()).toBe(true);

    // …drop ONE header role and the gate closes, naming exactly what is unassigned. The
    // role mandate is a SAVE invariant (canSave), not a per-step gate: the Metadata step's
    // own validity (labels) is unaffected.
    set(c, '{{poNumber}}', { role: '' });
    expect(c.missingHeaderRoles()).toEqual(['poNumber']);
    expect(c.headerStepValid()).toBe(true);
    expect(c.canSave()).toBe(false);

    await c.submit();
    expect(defineTemplate).not.toHaveBeenCalled();
    expect(c.submitError()).toContain('PO number');
  });

  it('role uniqueness: assigning a role a second time clears it from the first row', async () => {
    const c = make();
    c.templateId = 't1';
    await c.load();
    // Two header fields both aiming for `inspector` — the UI keeps only the latest.
    set(c, '{{poNumber}}', { header: true, serial: false, role: 'inspector' });
    c.onRoleChange(c.rows().find((r) => r.token === '{{poNumber}}')!);
    set(c, '{{reportDate}}', { header: true, serial: false, role: 'inspector' });
    c.onRoleChange(c.rows().find((r) => r.token === '{{reportDate}}')!);

    const roled = c.rows().filter((r) => r.role === 'inspector');
    expect(roled).toHaveLength(1);
    expect(roled[0]!.token).toBe('{{reportDate}}');
  });

  it('a role forces its type (inspectionDate → date) and clears required', async () => {
    const c = make();
    c.templateId = 't1';
    await c.load();
    const row = c.rows().find((r) => r.token === '{{poNumber}}')!;
    Object.assign(row, { header: true, serial: false, required: true, type: 'text', role: 'inspectionDate' });
    c.onRoleChange(row);
    expect(row.type).toBe('date');
    expect(row.required).toBe(false);
  });

  it('bulk section applies across included serial rows, skipping the roled marker', async () => {
    const c = make();
    await describeValid(c);
    c.bulkSection = 'Body';
    c.applyBulkSection();

    // Every plain serial field takes the section…
    expect(c.rows().find((r) => r.token === '{{b_od}}')!.section).toBe('Body');
    expect(c.rows().find((r) => r.token === '{{emi}}')!.section).toBe('Body');
    // …but the serialNumber marker is untouched (it has no section).
    expect(c.rows().find((r) => r.token === '{{sn}}')!.section).toBe('');
  });
});
