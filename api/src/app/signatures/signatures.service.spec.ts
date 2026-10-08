import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SignaturesService, MAX_SIGNATURE_BYTES } from './signatures.service';
import { PrismaService } from '../prisma/prisma.service';
import { AttachmentStorage } from '../storage/attachment-storage.types';

/** A structurally valid PNG shell (magic + IHDR + IEND); CRCs are not checked by the service. */
function makePng(width = 600, height = 200, padding = 0): Buffer {
  const ihdr = Buffer.alloc(8 + 13 + 4);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  const iend = Buffer.from([
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdr,
    Buffer.alloc(padding),
    iend,
  ]);
}

function setup() {
  const prisma = {
    userSignature: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      count: jest.fn(),
    },
    reportSignature: { count: jest.fn(), findFirst: jest.fn() },
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
  return { service, prisma, storage };
}

describe('SignaturesService', () => {
  const user = { id: 'u1', tenantId: 't1' };

  describe('saveForUser — validation', () => {
    it.each([
      ['empty buffer', Buffer.alloc(0)],
      ['non-PNG bytes', Buffer.from('this is definitely not a png at all....')],
      ['PNG missing IEND', makePng().subarray(0, makePng().length - 4)],
      ['too narrow', makePng(50, 200)],
      ['too short', makePng(600, 10)],
      ['too wide', makePng(5000, 200)],
      ['over the size cap', makePng(600, 200, MAX_SIGNATURE_BYTES)],
    ])('rejects %s without touching storage or the DB', async (_n, buf) => {
      const { service, prisma, storage } = setup();
      await expect(service.saveForUser(user, buf)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(storage.putSignature).not.toHaveBeenCalled();
      expect(prisma.userSignature.upsert).not.toHaveBeenCalled();
    });
  });

  describe('saveForUser — persistence', () => {
    it('stores a fresh uuid-keyed object and upserts the single row', async () => {
      const { service, prisma, storage } = setup();
      prisma.userSignature.findUnique.mockResolvedValue(null);
      prisma.userSignature.upsert.mockResolvedValue({ updatedAt: new Date(1) });

      const result = await service.saveForUser(user, makePng());

      const key = storage.putSignature.mock.calls[0][0] as string;
      expect(key).toMatch(/^t1\/u1\/[0-9a-f-]{36}$/);
      const args = prisma.userSignature.upsert.mock.calls[0][0];
      expect(args.where).toEqual({ userId: 'u1' });
      expect(args.create.storageKey).toBe(key);
      expect(args.create.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.hasSignature).toBe(true);
      expect(storage.deleteSignature).not.toHaveBeenCalled();
    });

    it('never overwrites: a replacement uses a different key than the previous object', async () => {
      const { service, prisma, storage } = setup();
      prisma.userSignature.findUnique.mockResolvedValue({
        storageKey: 't1/u1/old',
      });
      prisma.userSignature.upsert.mockResolvedValue({ updatedAt: new Date() });
      prisma.reportSignature.count.mockResolvedValue(0);

      await service.saveForUser(user, makePng());

      expect(storage.putSignature.mock.calls[0][0]).not.toBe('t1/u1/old');
    });

    it('deletes the previous object when no report references it', async () => {
      const { service, prisma, storage } = setup();
      prisma.userSignature.findUnique.mockResolvedValue({
        storageKey: 't1/u1/old',
      });
      prisma.userSignature.upsert.mockResolvedValue({ updatedAt: new Date() });
      prisma.reportSignature.count.mockResolvedValue(0);

      await service.saveForUser(user, makePng());

      expect(storage.deleteSignature).toHaveBeenCalledWith('t1/u1/old');
    });

    it('KEEPS the previous object when a submitted report froze a pointer to it', async () => {
      const { service, prisma, storage } = setup();
      prisma.userSignature.findUnique.mockResolvedValue({
        storageKey: 't1/u1/old',
      });
      prisma.userSignature.upsert.mockResolvedValue({ updatedAt: new Date() });
      prisma.reportSignature.count.mockResolvedValue(2);

      await service.saveForUser(user, makePng());

      expect(storage.deleteSignature).not.toHaveBeenCalled();
    });
  });

  describe('getImageForUser', () => {
    it('404s when the user has no signature', async () => {
      const { service, prisma } = setup();
      prisma.userSignature.findUnique.mockResolvedValue(null);
      await expect(service.getImageForUser('u1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404s when the row exists but the object is gone', async () => {
      const { service, prisma, storage } = setup();
      prisma.userSignature.findUnique.mockResolvedValue({ storageKey: 'k' });
      storage.getSignature.mockResolvedValue(null);
      await expect(service.getImageForUser('u1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('freezeForReport', () => {
    const args = {
      tenantId: 't1',
      inspectionReportId: 'r1',
      slot: 'inspectorSignature',
      userId: 'u1',
    };

    it('copies the current key + hash (not the file) into a ReportSignature', async () => {
      const { service, storage } = setup();
      const tx = {
        userSignature: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ storageKey: 't1/u1/cur', hash: 'h1' }),
        },
        reportSignature: {
          create: jest
            .fn()
            .mockImplementation(({ data }) =>
              Promise.resolve({ ...data, signedAt: new Date(5) }),
            ),
        },
      };

      const frozen = await service.freezeForReport(tx as never, args);

      expect(tx.reportSignature.create).toHaveBeenCalledWith({
        data: {
          tenantId: 't1',
          inspectionReportId: 'r1',
          slot: 'inspectorSignature',
          signedById: 'u1',
          storageKey: 't1/u1/cur',
          hash: 'h1',
          revisionNumber: 0,
        },
      });
      expect(frozen).toMatchObject({ storageKey: 't1/u1/cur', hash: 'h1' });
      // Pointer only: no object is read, written or copied.
      expect(storage.putSignature).not.toHaveBeenCalled();
      expect(storage.getSignature).not.toHaveBeenCalled();
    });

    it('returns null and writes nothing when the signer has no signature', async () => {
      const { service } = setup();
      const tx = {
        userSignature: { findUnique: jest.fn().mockResolvedValue(null) },
        reportSignature: { create: jest.fn() },
      };
      expect(await service.freezeForReport(tx as never, args)).toBeNull();
      expect(tx.reportSignature.create).not.toHaveBeenCalled();
    });
  });

  describe('getFrozenForReport', () => {
    it('reads the most recently frozen pointer for the slot', async () => {
      const { service, prisma } = setup();
      prisma.reportSignature.findFirst.mockResolvedValue({
        storageKey: 'k',
        hash: 'h',
        signedById: 'u1',
        signedAt: new Date(),
      });
      await service.getFrozenForReport('t1', 'r1', 'inspectorSignature');
      expect(prisma.reportSignature.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: 't1',
          inspectionReportId: 'r1',
          slot: 'inspectorSignature',
        },
        orderBy: { signedAt: 'desc' },
      });
    });

    it('returns null for a legacy report with no frozen pointer', async () => {
      const { service, prisma } = setup();
      prisma.reportSignature.findFirst.mockResolvedValue(null);
      expect(await service.getFrozenForReport('t1', 'r1', 's')).toBeNull();
    });
  });
});
