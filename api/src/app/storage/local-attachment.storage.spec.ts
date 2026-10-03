// Unit spec for the signature methods of the local (disk) storage backend. Runs
// against the real filesystem under api/uploads/signatures using a unique throwaway
// tenant id, cleaned up after.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { LocalAttachmentStorage } from './local-attachment.storage';

describe('LocalAttachmentStorage — user signatures', () => {
  const storage = new LocalAttachmentStorage();
  const tenantId = `spec-tenant-${process.pid}-${Date.now()}`;
  const root = path.join(process.cwd(), 'api', 'uploads', 'signatures');

  afterAll(async () => {
    await fs.rm(path.join(root, tenantId), { recursive: true, force: true });
  });

  it('builds the backend-agnostic tenant/user/objectId key', () => {
    expect(
      storage.buildSignatureKey({ tenantId, userId: 'u1', objectId: 'o1' }),
    ).toBe(`${tenantId}/u1/o1`);
  });

  it('round-trips put / get / delete', async () => {
    const key = storage.buildSignatureKey({
      tenantId,
      userId: 'u1',
      objectId: 'o1',
    });
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

    await storage.putSignature(key, bytes);
    const read = await storage.getSignature(key);
    expect(read!.equals(bytes)).toBe(true);

    await storage.deleteSignature(key);
    expect(await storage.getSignature(key)).toBeNull();
    // Deleting an already-missing object is a no-op.
    await expect(storage.deleteSignature(key)).resolves.toBeUndefined();
  });

  it('keeps an earlier object intact when a newer one is written for the same user', async () => {
    const oldKey = storage.buildSignatureKey({
      tenantId,
      userId: 'u2',
      objectId: 'old',
    });
    const newKey = storage.buildSignatureKey({
      tenantId,
      userId: 'u2',
      objectId: 'new',
    });
    await storage.putSignature(oldKey, Buffer.from('old'));
    await storage.putSignature(newKey, Buffer.from('new'));

    expect((await storage.getSignature(oldKey))!.toString()).toBe('old');
    expect((await storage.getSignature(newKey))!.toString()).toBe('new');
  });

  it('rejects a key that would escape the signatures root', async () => {
    await expect(
      storage.putSignature('../../escape', Buffer.from('x')),
    ).rejects.toThrow(/Invalid signature storage key/);
  });
});
