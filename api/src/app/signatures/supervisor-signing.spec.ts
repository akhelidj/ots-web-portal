import { ForbiddenException } from '@nestjs/common';
import {
  applySupervisorSignatures,
  assertApproverCanSign,
  supervisorSignatureFields,
} from './supervisor-signing';
import { SignatureFieldSpec } from './signature-fields';

const field = (key: string, required: boolean): SignatureFieldSpec => ({
  key,
  label: key,
  signer: 'SUPERVISOR',
  required,
  slot: `field:${key}`,
});

describe('supervisorSignatureFields', () => {
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
    const out = await supervisorSignatureFields(db as never, {
      tenantId: 't1',
      templateKey: 'K',
      templateVersion: 2,
    });
    expect(out.map((f) => f.key)).toEqual(['a']);
    expect(db.template.findUnique.mock.calls[0][0].where).toEqual({
      tenantId_templateKey_templateVersion: {
        tenantId: 't1',
        templateKey: 'K',
        templateVersion: 2,
      },
    });
  });

  it('is empty when the template is missing', async () => {
    const db = { template: { findUnique: jest.fn().mockResolvedValue(null) } };
    expect(
      await supervisorSignatureFields(db as never, {
        tenantId: 't1',
        templateKey: 'K',
        templateVersion: 1,
      }),
    ).toEqual([]);
  });
});

describe('assertApproverCanSign', () => {
  const db = (count: number) => ({
    userSignature: { count: jest.fn().mockResolvedValue(count) },
  });

  it('refuses with SIGNATURE_REQUIRED when a required field has no account signature', async () => {
    await expect(
      assertApproverCanSign(db(0) as never, [field('a', true)], 'u1'),
    ).rejects.toMatchObject({
      constructor: ForbiddenException,
      response: { code: 'SIGNATURE_REQUIRED' },
    });
  });

  it('passes when the approver has a signature', async () => {
    await expect(
      assertApproverCanSign(db(1) as never, [field('a', true)], 'u1'),
    ).resolves.toBeUndefined();
  });

  it('passes without looking when no field is required', async () => {
    const d = db(0);
    await assertApproverCanSign(d as never, [field('a', false)], 'u1');
    await assertApproverCanSign(d as never, [], 'u1');
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

  it('freezes the account signature per field, tagged with the CURRENT revision', async () => {
    const t = tx(3);
    await applySupervisorSignatures(t as never, {
      tenantId: 't1',
      reportId: 'r1',
      userId: 'u1',
      fields: [field('a', true), field('b', false)],
    });
    const rows = t.reportSignature.create.mock.calls.map((c) => c[0].data);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.slot)).toEqual(['field:a', 'field:b']);
    expect(rows.every((r) => r.revisionNumber === 3 && r.signedById === 'u1')).toBe(true);
  });

  it('does nothing (not even a read) with no fields', async () => {
    const t = tx();
    await applySupervisorSignatures(t as never, {
      tenantId: 't1',
      reportId: 'r1',
      userId: 'u1',
      fields: [],
    });
    expect(t.inspectionReport.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('writes nothing for a non-required field when the approver has no signature', async () => {
    const t = tx();
    t.userSignature.findUnique.mockResolvedValue(null);
    await applySupervisorSignatures(t as never, {
      tenantId: 't1',
      reportId: 'r1',
      userId: 'u1',
      fields: [field('a', false)],
    });
    expect(t.reportSignature.create).not.toHaveBeenCalled();
  });
});
