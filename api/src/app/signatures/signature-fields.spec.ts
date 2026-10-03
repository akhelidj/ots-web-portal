import { currentFieldSignatures, signatureFieldsOf } from './signature-fields';
import {
  fieldKeyOfSlot,
  fieldSignatureSlot,
  isFieldSignatureSlot,
  INSPECTOR_SIGNATURE_SLOT,
} from './signature-slots';
import { signatureMarker } from '../export/export-engine';

describe('signature slots', () => {
  it('round-trips a field key through its slot', () => {
    const slot = fieldSignatureSlot('customerSig');
    expect(slot).toBe('field:customerSig');
    expect(isFieldSignatureSlot(slot)).toBe(true);
    expect(fieldKeyOfSlot(slot)).toBe('customerSig');
  });

  it('never mistakes the inspector slot for a field slot', () => {
    expect(isFieldSignatureSlot(INSPECTOR_SIGNATURE_SLOT)).toBe(false);
  });

  it('keeps the marker format the embed sweep depends on', () => {
    expect(signatureMarker('field:x')).toBe('[[OTS_SIGNATURE:field:x]]');
  });
});

describe('signatureFieldsOf', () => {
  it('is null-safe for legacy definitions', () => {
    expect(signatureFieldsOf(null)).toEqual([]);
    expect(signatureFieldsOf({})).toEqual([]);
  });

  it('reads signature fields with a valid signer and skips the rest', () => {
    const specs = signatureFieldsOf({
      fields: [
        { key: 'a', label: 'Customer', type: 'signature', signer: 'CUSTOMER', required: true },
        { key: 'b', type: 'signature', signer: 'SUPERVISOR' },
        { key: 'c', type: 'signature', signer: 'NOBODY' },
        { key: 'd', type: 'text', signer: 'CUSTOMER' },
        { type: 'signature', signer: 'CUSTOMER' },
      ],
    });
    expect(specs).toEqual([
      { key: 'a', label: 'Customer', signer: 'CUSTOMER', required: true, slot: 'field:a' },
      { key: 'b', label: 'b', signer: 'SUPERVISOR', required: false, slot: 'field:b' },
    ]);
  });
});

describe('currentFieldSignatures', () => {
  const row = (
    id: string,
    report: string,
    slot: string,
    revisionNumber: number,
    signedAt: number,
  ) =>
    ({
      id,
      inspectionReportId: report,
      slot,
      revisionNumber,
      signedAt: new Date(signedAt),
    }) as never;

  it('keeps only rows of the current revision, newest per slot', async () => {
    const db = {
      reportSignature: {
        // Already ordered newest-first, as the query asks.
        findMany: jest.fn().mockResolvedValue([
          row('new', 'r1', 'field:a', 2, 30),
          row('old-rev', 'r1', 'field:b', 1, 25),
          row('dup', 'r1', 'field:a', 2, 20),
          row('other', 'r2', 'field:a', 0, 10),
        ]),
      },
    };
    const out = await currentFieldSignatures(db as never, {
      tenantId: 't1',
      reports: [
        { id: 'r1', revisionNumber: 2 },
        { id: 'r2', revisionNumber: 0 },
      ],
    });
    expect(out.get('r1')?.get('field:a')?.id).toBe('new');
    expect(out.get('r1')?.has('field:b')).toBe(false);
    expect(out.get('r2')?.get('field:a')?.id).toBe('other');
  });

  it('skips the query for no reports', async () => {
    const db = { reportSignature: { findMany: jest.fn() } };
    const out = await currentFieldSignatures(db as never, {
      tenantId: 't1',
      reports: [],
    });
    expect(out.size).toBe(0);
    expect(db.reportSignature.findMany).not.toHaveBeenCalled();
  });
});
