/**
 * Template `signature` fields — builder emission + write-time validation (unit; no DB).
 * A signature field marks the cell where a signer's picture goes; it names its signer
 * (CUSTOMER | SUPERVISOR), is header-scope only, and carries no system role.
 */
import { buildDefinition } from './definition-builder';
import { validateDefinition } from './definition-validator';
import {
  CandidateDefinition,
  DefineTemplateDto,
  OpsTokenField,
} from './definition-authoring.types';

const META = { templateKey: 'PUMP_REPORT', templateVersion: 1 };

const TOKENS: ReadonlySet<string> = new Set([
  '{{sn}}',
  '{{poNumber}}',
  '{{reportNumber}}',
  '{{customer}}',
  '{{inspBy}}',
  '{{apprBy}}',
  '{{inspDate}}',
  '{{inspSig}}',
  '{{custSig}}',
  '{{emi}}',
]);

function dto(extra: Partial<OpsTokenField>[] = []): DefineTemplateDto {
  const sig: OpsTokenField = {
    token: '{{custSig}}',
    label: 'Customer Signature',
    type: 'signature',
    required: true,
    scope: 'header',
    signer: 'CUSTOMER',
  };
  return {
    displayName: 'Pump Inspection',
    region: { id: 'serials', marker: '{{sn}}' },
    disposition: { field: 'emi', requiredForApproval: true },
    fields: [
      {
        token: '{{customer}}',
        label: 'Customer',
        type: 'text',
        required: false,
        scope: 'header',
        role: 'customer',
      },
      {
        token: '{{reportNumber}}',
        label: 'Report Number',
        type: 'text',
        required: false,
        scope: 'header',
        role: 'reportNumber',
      },
      {
        token: '{{poNumber}}',
        label: 'PO Number',
        type: 'text',
        required: false,
        scope: 'header',
        role: 'poNumber',
      },
      {
        token: '{{inspBy}}',
        label: 'Inspector',
        type: 'text',
        required: false,
        scope: 'header',
        role: 'inspector',
      },
      {
        token: '{{apprBy}}',
        label: 'Supervisor',
        type: 'text',
        required: false,
        scope: 'header',
        role: 'supervisor',
      },
      {
        token: '{{inspDate}}',
        label: 'Inspection Date',
        type: 'date',
        required: false,
        scope: 'header',
        role: 'inspectionDate',
      },
      {
        token: '{{inspSig}}',
        label: 'Inspector Signature',
        type: 'text',
        required: false,
        scope: 'header',
        role: 'inspectorSignature',
      },
      {
        token: '{{sn}}',
        label: 'Serial Number',
        type: 'text',
        required: false,
        scope: 'item',
        role: 'serialNumber',
      },
      {
        token: '{{emi}}',
        label: 'EMI Result',
        type: 'select',
        required: true,
        scope: 'item',
        section: 'Body',
        options: ['PASS', 'FAIL'],
      },
      sig,
      ...(extra as OpsTokenField[]),
    ],
  };
}

const clone = (d: CandidateDefinition): CandidateDefinition =>
  JSON.parse(JSON.stringify(d)) as CandidateDefinition;

describe('signature fields — builder', () => {
  it('exports the field as a per-slot signature marker and stores its signer', () => {
    const c = buildDefinition(META, dto());
    const stored = c.fields.find((f) => f.key === 'custSig')!;
    expect(stored).toMatchObject({
      type: 'signature',
      signer: 'CUSTOMER',
      required: true,
    });
    const entry = c.export.global.find((e) => e.token === '{{custSig}}');
    expect(entry).toEqual({ token: '{{custSig}}', signature: 'field:custSig' });
  });

  it('does not add a signer to non-signature fields', () => {
    const c = buildDefinition(META, dto());
    expect(c.fields.find((f) => f.key === 'customer')).not.toHaveProperty(
      'signer',
    );
  });
});

describe('signature fields — validator', () => {
  it('accepts a header signature field with a known signer', () => {
    expect(validateDefinition(buildDefinition(META, dto()), TOKENS)).toEqual({
      ok: true,
    });
  });

  it('accepts a SUPERVISOR signer', () => {
    const c = clone(buildDefinition(META, dto()));
    c.fields.find((f) => f.key === 'custSig')!.signer = 'SUPERVISOR';
    expect(validateDefinition(c, TOKENS)).toEqual({ ok: true });
  });

  it('rejects a missing signer (signer-known)', () => {
    const c = clone(buildDefinition(META, dto()));
    delete c.fields.find((f) => f.key === 'custSig')!.signer;
    expect(validateDefinition(c, TOKENS)).toMatchObject({
      ok: false,
      check: 'signer-known',
    });
  });

  it('rejects an unknown signer (signer-known)', () => {
    const c = clone(buildDefinition(META, dto()));
    (c.fields.find((f) => f.key === 'custSig') as { signer: string }).signer =
      'INSPECTOR';
    expect(validateDefinition(c, TOKENS)).toMatchObject({
      ok: false,
      check: 'signer-known',
    });
  });

  it('rejects a signer on a non-signature field (signer-type)', () => {
    const c = clone(buildDefinition(META, dto()));
    c.fields.find((f) => f.key === 'customer')!.signer = 'CUSTOMER';
    expect(validateDefinition(c, TOKENS)).toMatchObject({
      ok: false,
      check: 'signer-type',
    });
  });

  it('rejects an item-scope signature (signature-header-scope)', () => {
    const c = clone(buildDefinition(META, dto()));
    c.fields.find((f) => f.key === 'custSig')!.scope = 'item';
    expect(validateDefinition(c, TOKENS)).toMatchObject({
      ok: false,
      check: 'signature-header-scope',
    });
  });

  it('rejects a system role on a signature field (signature-no-role)', () => {
    const c = clone(buildDefinition(META, dto()));
    c.fields.find((f) => f.key === 'custSig')!.role = 'inspector';
    const outcome = validateDefinition(c, TOKENS);
    expect(outcome.ok).toBe(false);
  });
});
