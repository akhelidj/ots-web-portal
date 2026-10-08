/**
 * The Define-Template wizard — the header-only `signature` field type and its signer.
 * A signature field is a per-report signer's picture (CUSTOMER draws it, SUPERVISOR's account
 * signature is applied at approval); ops must declare the signer and may mark it required
 * (which blocks export until signed). It is never a serial field and never a form input.
 */
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TemplateDefineComponent } from './template-define.component';
import {
  AdminTemplatesService,
  ExtractedToken,
  StoredDefinition,
} from '@portal/features/templates/services/admin-templates.service';

const TOKENS: ExtractedToken[] = [
  { token: '{{sn}}', cell: 'A2', row: 2 },
  { token: '{{custSig}}', cell: 'B1', row: 1 },
  { token: '{{b_od}}', cell: 'D2', row: 2 },
];

describe('TemplateDefineComponent — signature field', () => {
  function make(definitionJson: StoredDefinition | null = null) {
    TestBed.configureTestingModule({
      imports: [TemplateDefineComponent],
      providers: [
        {
          provide: AdminTemplatesService,
          useValue: {
            getTokens: jest.fn().mockResolvedValue(TOKENS),
            getDefinition: jest.fn().mockResolvedValue({ definitionJson }),
            defineTemplate: jest.fn(),
          },
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

  afterEach(() => TestBed.resetTestingModule());

  const row = (c: TemplateDefineComponent, token: string) =>
    c.rows().find((r) => r.token === token)!;

  async function withSignatureRow() {
    const c = make();
    c.templateId = 't1';
    await c.load();
    const r = row(c, '{{custSig}}');
    Object.assign(r, {
      header: true,
      serial: false,
      label: 'Customer approval',
    });
    return { c, r };
  }

  it('offers signature only as a header type, not for serial fields', () => {
    const c = make();
    expect(c.headerFieldTypes).toContain('signature');
    expect(c.fieldTypes).not.toContain('signature');
    expect(c.signerOptions.map((o) => o.value)).toEqual([
      'CUSTOMER',
      'SUPERVISOR',
    ]);
  });

  it('requires a signer before the header step is valid', async () => {
    const { c, r } = await withSignatureRow();
    r.type = 'signature';
    c.onTypeChange(r);
    expect(c.isSignature(r)).toBe(true);
    expect(r.signer).toBe('');
    expect(c.headerStepValid()).toBe(false);

    r.signer = 'CUSTOMER';
    expect(c.headerStepValid()).toBe(true);
  });

  it('emits the signer (and required) on the header field of the DTO', async () => {
    const { c, r } = await withSignatureRow();
    Object.assign(r, {
      type: 'signature',
      signer: 'SUPERVISOR',
      required: true,
    });

    const field = c.buildDto().fields.find((f) => f.token === '{{custSig}}');
    expect(field).toEqual({
      token: '{{custSig}}',
      label: 'Customer approval',
      type: 'signature',
      required: true,
      scope: 'header',
      signer: 'SUPERVISOR',
    });
  });

  it('drops the signer when the type changes away from signature', async () => {
    const { c, r } = await withSignatureRow();
    Object.assign(r, { type: 'signature', signer: 'CUSTOMER' });
    r.type = 'text';
    c.onTypeChange(r);
    expect(r.signer).toBe('');
  });

  it('is header-only: demoting it to the serial step resets it to plain text', async () => {
    const { c, r } = await withSignatureRow();
    Object.assign(r, { type: 'signature', signer: 'CUSTOMER' });
    c.onHeaderToggle(r, false);
    expect(r.type).toBe('text');
    expect(r.signer).toBe('');
    expect(r.serial).toBe(true);
  });

  it('a system role wins over the signature type and clears the signer', async () => {
    const { c, r } = await withSignatureRow();
    Object.assign(r, {
      type: 'signature',
      signer: 'CUSTOMER',
      role: 'inspectorSignature',
    });
    c.onRoleChange(r);
    expect(r.type).toBe('text');
    expect(r.signer).toBe('');
  });

  it('hydrates the saved signer back into the read-only recap', async () => {
    const c = make({
      displayName: 'Signed Report',
      fields: [
        {
          key: 'sn',
          label: 'Serial Number',
          type: 'text',
          scope: 'item',
          role: 'serialNumber',
        },
        {
          key: 'custSig',
          label: 'Customer approval',
          type: 'signature',
          scope: 'header',
          required: true,
          signer: 'CUSTOMER',
        },
      ],
    } as unknown as StoredDefinition);
    c.templateId = 't1';
    await c.load();
    const r = c.rows().find((x) => x.token === '{{custSig}}')!;
    expect(r.type).toBe('signature');
    expect(r.signer).toBe('CUSTOMER');
    expect(r.required).toBe(true);
  });
});
