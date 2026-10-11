import { ForbiddenException } from '@nestjs/common';
import {
  applySupervisorSignatures,
  approvalSigningFor,
  ApprovalSigning,
  assertApproverCanSign,
} from './supervisor-signing';
import { SignatureFieldSpec } from './signature-fields';

const field = (key: string, required: boolean): SignatureFieldSpec => ({
  key,
  label: key,
  signer: 'SUPERVISOR',
  required,
  slot: `field:${key}`,
});

const signing = (
  fields: SignatureFieldSpec[],
  roleBound = false,
): ApprovalSigning => ({ fields, roleBound });

describe('approvalSigningFor', () => {
  const report = { tenantId: 't1', templateKey: 'K', templateVersion: 2 };

  it('returns only SUPERVISOR-signer fields of the pinned template', async () => {
    const db = {
      template: {
        findUnique: jest.fn().mockResolvedValue({
          definitionJson: {
            fields: [
              { key: 'a', type: 'signature', signer: 'SUPERVISOR', required: true },
              { key: 'b', type: 'signature', signer: 'CUSTOMER' },
              { key: 'c', type: 'text' },
            ],
          },
        }),
      },
    };
    const out = await approvalSigningFor(db as never, report);
    expect(out.fields.map((f) => f.key)).toEqual(['a']);
    expect(out.roleBound).toBe(false);
    expect(db.template.findUnique.mock.calls[0][0].where).toEqual({
      tenantId_templateKey_templateVersion: {
        tenantId: 't1',
        templateKey: 'K',
        templateVersion: 2,
      },
    });
  });

  it('detects the supervisorSignature system role', async () => {
    const db = {
      template: {
        findUnique: jest.fn().mockResolvedValue({
          definitionJson: {
            fields: [],
            export: {
              global: [
                { token: '{{x}}', computed: 'inspectorSignature' },
                { token: '{{y}}', computed: 'supervisorSignature' },
              ],
            },
          },
        }),
      },
    };
    expect((await approvalSigningFor(db as never, report)).roleBound).toBe(true);
  });

  it('is empty when the template is missing', async () => {
    const db = { template: { findUnique: jest.fn().mockResolvedValue(null) } };
    expect(await approvalSigningFor(db as never, report)).toEqual({
      fields: [],
      roleBound: false,
    });
  });
});

describe('assertApproverCanSign', () => {
  const db = (count: number) => ({
    userSignature: { count: jest.fn().mockResolvedValue(count) },
  });

  it('refuses with SIGNATURE_REQUIRED when a required field has no account signature', async () => {
    await expect(
      assertApproverCanSign(db(0) as never, signing([field('a', true)]), 'u1'),
    ).rejects.toMatchObject({
      constructor: ForbiddenException,
      response: { code: 'SIGNATURE_REQUIRED' },
    });
  });

  it('refuses with SIGNATURE_REQUIRED when the supervisorSignature role is bound', async () => {
    await expect(
      assertApproverCanSign(db(0) as never, signing([], true), 'u1'),
    ).rejects.toMatchObject({
      constructor: ForbiddenException,
      response: { code: 'SIGNATURE_REQUIRED' },
    });
  });

  it('passes when the approver has a signature', async () => {
    await expect(
      assertApproverCanSign(db(1) as never, signing([field('a', true)], true), 'u1'),
    ).resolves.toBeUndefined();
  });

  it('passes without looking when nothing is required', async () => {
    const d = db(0);
    await assertApproverCanSign(d as never, signing([field('a', false)]), 'u1');
    await assertApproverCanSign(d as never, signing([]), 'u1');
    expect(d.userSignature.count).not.toHaveBeenCalled();
  });
});

describe('applySupervisorSignatures', () => {
  const tx = (revisionNumber = 3) => ({
    inspectionReport: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ revisionNumber }),
    },
    userSignature: {
      findUnique: jest.fn().mockResolvedValue({ storageKey: 'k', hash: 'h' }),
    },
    reportSignature: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
    },
  });
  const args = (s: ApprovalSigning) => ({
    tenantId: 't1',
    reportId: 'r1',
    userId: 'u1',
    signing: s,
  });

  it('freezes the account signature per field, tagged with the CURRENT revision', async () => {
    const t = tx(3);
    await applySupervisorSignatures(
      t as never,
      args(signing([field('a', true), field('b', false)])),
    );
    const rows = t.reportSignature.create.mock.calls.map((c) => c[0].data);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.slot)).toEqual(['field:a', 'field:b']);
    expect(rows.every((r) => r.revisionNumber === 3 && r.signedById === 'u1')).toBe(true);
  });

  it('freezes the supervisorSignature role slot when the template binds it', async () => {
    const t = tx(2);
    await applySupervisorSignatures(t as never, args(signing([], true)));
    const rows = t.reportSignature.create.mock.calls.map((c) => c[0].data);
    expect(rows.map((r) => r.slot)).toEqual(['supervisorSignature']);
    expect(rows[0].revisionNumber).toBe(2);
  });

  it('does nothing (not even a read) with no fields and no role', async () => {
    const t = tx();
    await applySupervisorSignatures(t as never, args(signing([])));
    expect(t.inspectionReport.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('writes nothing when the approver has no signature', async () => {
    const t = tx();
    t.userSignature.findUnique.mockResolvedValue(null);
    await applySupervisorSignatures(t as never, args(signing([field('a', false)])));
    expect(t.reportSignature.create).not.toHaveBeenCalled();
  });
});
