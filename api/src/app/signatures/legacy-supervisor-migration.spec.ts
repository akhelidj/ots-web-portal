import { migrateDefinition, Definition } from './legacy-supervisor-migration';

const base = (): Definition => ({
  fields: [
    { key: 'inspector', role: 'inspector', type: 'text', scope: 'header' },
    {
      key: 'supSig',
      type: 'signature',
      signer: 'SUPERVISOR',
      scope: 'header',
      label: 'Supervisor signature',
      required: false,
    },
    { key: 'custSig', type: 'signature', signer: 'CUSTOMER', scope: 'header', required: true },
  ],
  export: {
    global: [
      { token: '{{supSig}}', signature: 'field:supSig' },
      { token: '{{custSig}}', signature: 'field:custSig' },
    ],
  },
});

describe('migrateDefinition', () => {
  it('returns null when no legacy supervisor field exists', () => {
    const d = base();
    d.fields = d.fields.filter((f) => f.signer !== 'SUPERVISOR');
    expect(migrateDefinition(d)).toBeNull();
  });

  it('promotes the legacy field to the role and leaves the customer field alone', () => {
    const out = migrateDefinition(base())!;
    expect(out.slots).toEqual(['field:supSig']);
    const f = out.next.fields.find((x) => x.key === 'supSig')!;
    expect(f).toMatchObject({ type: 'text', role: 'supervisorSignature', label: 'Supervisor signature' });
    expect(f.signer).toBeUndefined();
    expect(out.next.export.global).toEqual([
      { token: '{{supSig}}', computed: 'supervisorSignature' },
      { token: '{{custSig}}', signature: 'field:custSig' },
    ]);
    expect(out.next.fields.find((x) => x.key === 'custSig')).toMatchObject({ signer: 'CUSTOMER' });
  });

  it('re-points extra legacy fields at the role picture and drops them', () => {
    const d = base();
    d.fields.push({ key: 'supSig2', type: 'signature', signer: 'SUPERVISOR', scope: 'header' });
    d.export.global.push({ token: '{{supSig2}}', signature: 'field:supSig2' });
    const out = migrateDefinition(d)!;
    expect(out.slots).toEqual(['field:supSig', 'field:supSig2']);
    expect(out.next.fields.some((f) => f.key === 'supSig2')).toBe(false);
    expect(out.next.export.global).toContainEqual({
      token: '{{supSig2}}',
      signature: 'supervisorSignature',
    });
    expect(out.next.fields.filter((f) => f.role === 'supervisorSignature')).toHaveLength(1);
  });

  it('when the role is already bound, only re-points the legacy field', () => {
    const d = base();
    d.fields.push({ key: 'sup', role: 'supervisorSignature', type: 'text', scope: 'header' });
    d.export.global.push({ token: '{{sup}}', computed: 'supervisorSignature' });
    const out = migrateDefinition(d)!;
    expect(out.next.fields.filter((f) => f.role === 'supervisorSignature')).toHaveLength(1);
    expect(out.next.export.global).toContainEqual({
      token: '{{supSig}}',
      signature: 'supervisorSignature',
    });
  });

  it('is idempotent', () => {
    expect(migrateDefinition(migrateDefinition(base())!.next)).toBeNull();
  });
});
