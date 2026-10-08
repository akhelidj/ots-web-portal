import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  CustomerBrandingService,
  sniffLogoType,
} from './customer-branding.service';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
]);

describe('CustomerBrandingService', () => {
  const customer = {
    id: 'c1',
    tenantId: 't1',
    name: 'Noble',
    brandColor: '#123456',
    logoKey: 't1/c1/old-id',
    logoMimeType: 'image/png',
    version: 3,
  };

  function setup(overrides: { count?: number; row?: unknown } = {}) {
    const tx = {
      customer: {
        updateMany: jest
          .fn()
          .mockResolvedValue({ count: overrides.count ?? 1 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ ...customer, version: 4 }),
      },
    };
    const prisma = {
      customer: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            overrides.row === undefined ? customer : overrides.row,
          ),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const storage = {
      buildLogoKey: jest.fn(
        (r: { tenantId: string; customerId: string; objectId: string }) =>
          `${r.tenantId}/${r.customerId}/${r.objectId}`,
      ),
      putLogo: jest.fn().mockResolvedValue(undefined),
      getLogo: jest.fn().mockResolvedValue(PNG),
      deleteLogo: jest.fn().mockResolvedValue(undefined),
    };
    const service = new CustomerBrandingService(
      prisma as never,
      storage as never,
    );
    return { service, prisma, storage, tx };
  }

  it('sniffs raster types from the bytes and refuses anything else (e.g. SVG)', () => {
    expect(sniffLogoType(PNG)).toBe('image/png');
    expect(sniffLogoType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg',
    );
    expect(sniffLogoType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe(
      'image/webp',
    );
    expect(
      sniffLogoType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeNull();
  });

  it('exposes the branding read model with the logo object id as cache-buster', async () => {
    const { service } = setup();
    await expect(service.getBranding('t1', 'c1')).resolves.toEqual({
      customerId: 'c1',
      name: 'Noble',
      brandColor: '#123456',
      logoId: 'old-id',
    });
  });

  it('never reads a customer from another tenant', async () => {
    const { service } = setup();
    await expect(
      service.getBranding('other-tenant', 'c1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stores a new logo under a fresh key, then deletes the old object', async () => {
    const { service, storage, tx } = setup();
    await service.setLogo('t1', 'u1', 'c1', 3, PNG);

    const newKey = storage.putLogo.mock.calls[0][0] as string;
    expect(newKey).toMatch(/^t1\/c1\/.+/);
    expect(newKey).not.toBe(customer.logoKey);
    expect(storage.putLogo).toHaveBeenCalledWith(newKey, PNG, 'image/png');
    expect(tx.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', version: 3 },
      data: {
        logoKey: newKey,
        logoMimeType: 'image/png',
        version: { increment: 1 },
      },
    });
    expect(storage.deleteLogo).toHaveBeenCalledWith(customer.logoKey);
  });

  it('rejects a stale version before touching storage', async () => {
    const { service, storage } = setup();
    await expect(
      service.setLogo('t1', 'u1', 'c1', 2, PNG),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(storage.putLogo).not.toHaveBeenCalled();
  });

  it('a lost race deletes the freshly written object and keeps the old one', async () => {
    const { service, storage } = setup({ count: 0 });
    await expect(
      service.setLogo('t1', 'u1', 'c1', 3, PNG),
    ).rejects.toBeInstanceOf(ConflictException);
    const newKey = storage.putLogo.mock.calls[0][0];
    expect(storage.deleteLogo).toHaveBeenCalledWith(newKey);
    expect(storage.deleteLogo).not.toHaveBeenCalledWith(customer.logoKey);
  });

  it('refuses non-image uploads', async () => {
    const { service } = setup();
    await expect(
      service.setLogo('t1', 'u1', 'c1', 3, Buffer.from('<svg/>')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('removing the logo clears the columns and deletes the object', async () => {
    const { service, storage, tx } = setup();
    await service.removeLogo('t1', 'u1', 'c1', 3);
    expect(tx.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', version: 3 },
      data: { logoKey: null, logoMimeType: null, version: { increment: 1 } },
    });
    expect(storage.deleteLogo).toHaveBeenCalledWith(customer.logoKey);
  });
});
