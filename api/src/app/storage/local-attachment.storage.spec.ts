// Unit spec for the LOCAL attachment storage backend — the default driver.
//
// This pins the historical on-disk behavior that FilesService used to perform
// inline: byte-identical paths (`api/uploads/attachments/<attachmentId>`), the
// silent no-op delete, and the boot-time placeholder reconciliation. The suite
// writes real files under a unique subtree of the actual upload directory (the
// backend derives its dir from process.cwd()) and cleans them up, so it proves
// the real disk path without a mock.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { LocalAttachmentStorage } from './local-attachment.storage';
import { StorageObjectRef } from './attachment-storage.types';

const attachmentDir = path.join(
  process.cwd(),
  'api',
  'uploads',
  'attachments',
);

function makeRef(attachmentId: string): StorageObjectRef {
  // The local backend keys on attachmentId alone; the hierarchy is carried but
  // deliberately ignored on disk.
  return {
    tenantId: 'tenant-1',
    customerId: 'customer-1',
    reportId: 'report-1',
    attachmentId,
  };
}

describe('LocalAttachmentStorage', () => {
  let storage: LocalAttachmentStorage;
  const created: string[] = [];

  function newId(): string {
    const id = `spec-local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    created.push(id);
    return id;
  }

  beforeEach(() => {
    storage = new LocalAttachmentStorage();
  });

  afterAll(async () => {
    await Promise.all(
      created.map((id) =>
        fs.unlink(path.join(attachmentDir, id)).catch(() => undefined),
      ),
    );
  });

  it('put writes bytes to the byte-identical flat path and get reads them back', async () => {
    const id = newId();
    const buffer = Buffer.from('hello attachment', 'utf-8');

    await storage.put(makeRef(id), buffer);

    // Byte-identical location: api/uploads/attachments/<attachmentId>.
    const onDisk = await fs.readFile(path.join(attachmentDir, id));
    expect(onDisk.equals(buffer)).toBe(true);

    const read = await storage.get(makeRef(id));
    expect(read).not.toBeNull();
    expect(read!.equals(buffer)).toBe(true);
  });

  it('get returns null when the object does not exist', async () => {
    expect(await storage.get(makeRef(newId()))).toBeNull();
  });

  it('exists reflects presence', async () => {
    const id = newId();
    expect(await storage.exists(makeRef(id))).toBe(false);
    await storage.put(makeRef(id), Buffer.from('x'));
    expect(await storage.exists(makeRef(id))).toBe(true);
  });

  it('delete removes the object and is a silent no-op when already missing', async () => {
    const id = newId();
    await storage.put(makeRef(id), Buffer.from('x'));
    await storage.delete(makeRef(id));
    expect(await storage.exists(makeRef(id))).toBe(false);

    // Second delete must not throw.
    await expect(storage.delete(makeRef(id))).resolves.toBeUndefined();
  });

  it('reconcile writes a placeholder for a missing binary and leaves an existing one untouched', async () => {
    const missingId = newId();
    const presentId = newId();
    const original = Buffer.from('the real bytes', 'utf-8');
    await storage.put(makeRef(presentId), original);

    await storage.reconcile([
      { ref: makeRef(missingId), filename: 'gone.pdf' },
      { ref: makeRef(presentId), filename: 'kept.pdf' },
    ]);

    const placeholder = await storage.get(makeRef(missingId));
    expect(placeholder).not.toBeNull();
    expect(placeholder!.toString('utf-8')).toContain(
      "Attachment 'gone.pdf' was migrated from legacy storage.",
    );

    // The present binary is preserved exactly.
    const kept = await storage.get(makeRef(presentId));
    expect(kept!.equals(original)).toBe(true);
  });

  it('reconcile with no items still materializes the upload directory', async () => {
    await storage.reconcile([]);
    await expect(fs.access(attachmentDir)).resolves.toBeUndefined();
  });
});
