import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { InspectionReportStatus, UserRole } from '@prisma/client';
import { SignaturesService } from './signatures.service';
import { PrismaService } from '../prisma/prisma.service';
import { AttachmentStorage } from '../storage/attachment-storage.types';

function makePng(): Buffer {
  const ihdr = Buffer.alloc(8 + 13 + 4);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(600, 8);
  ihdr.writeUInt32BE(200, 12);
  const iend = Buffer.from([
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdr,
    iend,
  ]);
}

const DEFINITION = {
  fields: [
    {
      key: 'custSig',
      label: 'Customer',
      type: 'signature',
      signer: 'CUSTOMER',
      required: true,
    },
    {
      key: 'supSig',
      label: 'Supervisor',
      type: 'signature',
      signer: 'SUPERVISOR',
    },
  ],
};

const customer = {
  id: 'u1',
  tenantId: 't1',
  role: UserRole.CUSTOMER,
  customerId: 'c1',
};

function report(
  status: InspectionReportStatus = InspectionReportStatus.APPROVED,
) {
  return {
    id: 'r1',
    reportNumber: 'RPT-1',
    poNumber: 'PO-1',
    status,
    revisionNumber: 1,
    templateKey: 'K',
    templateVersion: 1,
  };
}

function setup(
  opts: { status?: InspectionReportStatus; alreadySigned?: number } = {},
) {
  const tx = {
    inspectionReport: {
      findUnique: jest.fn().mockResolvedValue({
        status: opts.status ?? 'APPROVED',
        revisionNumber: 1,
      }),
    },
    reportSignature: {
      count: jest.fn().mockResolvedValue(opts.alreadySigned ?? 0),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    inspectionReport: {
      findFirst: jest.fn().mockResolvedValue(report(opts.status)),
      findMany: jest.fn().mockResolvedValue([report(opts.status)]),
    },
    template: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { templateKey: 'K', templateVersion: 1, definitionJson: DEFINITION },
        ]),
    },
    reportSignature: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const storage = {
    buildSignatureKey: jest.fn(
      (r: { tenantId: string; userId: string; objectId: string }) =>
        `${r.tenantId}/${r.userId}/${r.objectId}`,
    ),
    putSignature: jest.fn().mockResolvedValue(undefined),
    getSignature: jest.fn(),
    deleteSignature: jest.fn().mockResolvedValue(undefined),
  };
  const service = new SignaturesService(
    prisma as unknown as PrismaService,
    storage as unknown as AttachmentStorage,
  );
  return { service, prisma, storage, tx };
}

describe('SignaturesService — customer signature fields', () => {
  describe('signCustomerField', () => {
    it('records a pointer tagged with the current revision', async () => {
      const { service, tx, storage } = setup();
      await service.signCustomerField(customer, 'r1', 'custSig', makePng());

      expect(storage.putSignature).toHaveBeenCalledTimes(1);
      const data = tx.reportSignature.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        tenantId: 't1',
        inspectionReportId: 'r1',
        slot: 'field:custSig',
        signedById: 'u1',
        revisionNumber: 1,
      });
    });

    it.each([UserRole.INSPECTOR, UserRole.SUPERVISOR, UserRole.ADMIN])(
      'refuses a %s',
      async (role) => {
        const { service, storage } = setup();
        await expect(
          service.signCustomerField(
            { ...customer, role },
            'r1',
            'custSig',
            makePng(),
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(storage.putSignature).not.toHaveBeenCalled();
      },
    );

    it('409 NOT_SIGNABLE before approval, writing nothing', async () => {
      const { service, storage } = setup({
        status: InspectionReportStatus.IN_INSPECTION,
      });
      await expect(
        service.signCustomerField(customer, 'r1', 'custSig', makePng()),
      ).rejects.toMatchObject({ response: { code: 'NOT_SIGNABLE' } });
      expect(storage.putSignature).not.toHaveBeenCalled();
    });

    it('404s for a SUPERVISOR-signer field and for an unknown key', async () => {
      const { service } = setup();
      await expect(
        service.signCustomerField(customer, 'r1', 'supSig', makePng()),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.signCustomerField(customer, 'r1', 'nope', makePng()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409 ALREADY_SIGNED and removes the orphaned object', async () => {
      const { service, storage, tx } = setup({ alreadySigned: 1 });
      await expect(
        service.signCustomerField(customer, 'r1', 'custSig', makePng()),
      ).rejects.toMatchObject({ response: { code: 'ALREADY_SIGNED' } });
      expect(tx.reportSignature.create).not.toHaveBeenCalled();
      expect(storage.deleteSignature).toHaveBeenCalledTimes(1);
    });

    it('scopes the report lookup to the customer', async () => {
      const { service, prisma } = setup();
      await service.signCustomerField(customer, 'r1', 'custSig', makePng());
      expect(
        prisma.inspectionReport.findFirst.mock.calls[0][0].where,
      ).toMatchObject({
        id: 'r1',
        tenantId: 't1',
        customerId: 'c1',
      });
    });

    it('404s a report outside the customer', async () => {
      const { service, prisma } = setup();
      prisma.inspectionReport.findFirst.mockResolvedValue(null);
      await expect(
        service.signCustomerField(customer, 'r1', 'custSig', makePng()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listPendingForCustomer', () => {
    it('lists the unsigned CUSTOMER fields of approved reports', async () => {
      const { service } = setup();
      expect(await service.listPendingForCustomer(customer)).toEqual([
        {
          reportId: 'r1',
          reportNumber: 'RPT-1',
          poNumber: 'PO-1',
          status: 'APPROVED',
          fields: [{ key: 'custSig', label: 'Customer', required: true }],
        },
      ]);
    });

    it('drops a report once its field is signed on the current revision', async () => {
      const { service, prisma } = setup();
      prisma.reportSignature.findMany.mockResolvedValue([
        {
          id: 's1',
          inspectionReportId: 'r1',
          slot: 'field:custSig',
          revisionNumber: 1,
          signedAt: new Date(),
        },
      ]);
      expect(await service.listPendingForCustomer(customer)).toEqual([]);
    });

    it('still lists it when the only signature is from a previous revision', async () => {
      const { service, prisma } = setup();
      prisma.reportSignature.findMany.mockResolvedValue([
        {
          id: 's0',
          inspectionReportId: 'r1',
          slot: 'field:custSig',
          revisionNumber: 0,
          signedAt: new Date(),
        },
      ]);
      expect(await service.listPendingForCustomer(customer)).toHaveLength(1);
    });

    it('is empty for non-customers', async () => {
      const { service, prisma } = setup();
      expect(
        await service.listPendingForCustomer({
          ...customer,
          role: UserRole.ADMIN,
        }),
      ).toEqual([]);
      expect(prisma.inspectionReport.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getFieldStates', () => {
    it('reports every field with signable + signed flags', async () => {
      const { service } = setup();
      const states = await service.getFieldStates(customer, 'r1');
      expect(states.signable).toBe(true);
      expect(states.fields.map((f) => [f.key, f.signer, f.signed])).toEqual([
        ['custSig', 'CUSTOMER', false],
        ['supSig', 'SUPERVISOR', false],
      ]);
      expect(states.inspector).toBeNull();
    });

    it('reports the inspector signature frozen at submission', async () => {
      const { service, prisma } = setup();
      prisma.reportSignature.findFirst.mockResolvedValue({
        storageKey: 't1/u9/obj',
        hash: 'h',
        signedById: 'u9',
        signedAt: new Date('2026-01-02T08:00:00Z'),
      });
      prisma.user.findMany.mockResolvedValue([
        { id: 'u9', name: 'Inspector Nine', email: 'i@x.test' },
      ]);
      const states = await service.getFieldStates(customer, 'r1');
      expect(states.inspector).toEqual({
        signed: true,
        signedAt: new Date('2026-01-02T08:00:00Z'),
        signedByName: 'Inspector Nine',
      });
    });
  });

  describe('getSignatureImage', () => {
    it('serves the inspector signature frozen on the report', async () => {
      const { service, prisma, storage } = setup();
      const png = makePng();
      prisma.reportSignature.findFirst.mockResolvedValue({
        storageKey: 'k-insp',
      });
      storage.getSignature.mockResolvedValue(png);
      await expect(
        service.getSignatureImage(customer, 'r1', 'inspector'),
      ).resolves.toBe(png);
      expect(storage.getSignature).toHaveBeenCalledWith('k-insp');
    });

    it("serves a field's current-revision signature", async () => {
      const { service, prisma, storage } = setup();
      const png = makePng();
      prisma.reportSignature.findMany.mockResolvedValue([
        {
          inspectionReportId: 'r1',
          slot: 'field:custSig',
          revisionNumber: 1,
          storageKey: 'k-cust',
          signedAt: new Date(),
        },
      ]);
      storage.getSignature.mockResolvedValue(png);
      await expect(
        service.getSignatureImage(customer, 'r1', 'custSig'),
      ).resolves.toBe(png);
      expect(storage.getSignature).toHaveBeenCalledWith('k-cust');
    });

    it('404s when nothing is signed, and for an unknown key', async () => {
      const { service } = setup();
      await expect(
        service.getSignatureImage(customer, 'r1', 'custSig'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.getSignatureImage(customer, 'r1', 'nope'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("never resolves another customer's report", async () => {
      const { service, prisma } = setup();
      prisma.inspectionReport.findFirst.mockResolvedValue(null);
      await expect(
        service.getSignatureImage(customer, 'r1', 'inspector'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(
        prisma.inspectionReport.findFirst.mock.calls[0][0].where,
      ).toMatchObject({
        customerId: 'c1',
      });
    });
  });
});
