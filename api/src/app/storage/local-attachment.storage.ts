import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  AttachmentStorage,
  ReconcileItem,
  StorageObjectRef,
} from './attachment-storage.types';

/**
 * On-disk attachment backend — the historical behavior. Objects live flat under
 * `api/uploads/attachments/<attachmentId>`, byte-identical to the pre-migration
 * layout, so nothing local changes when `STORAGE_DRIVER=local` (the default).
 * The hierarchical identifiers on {@link StorageObjectRef} are ignored here; only
 * `attachmentId` participates in the path.
 */
@Injectable()
export class LocalAttachmentStorage implements AttachmentStorage {
  private readonly logger = new Logger(LocalAttachmentStorage.name);
  private readonly attachmentDir = path.join(
    process.cwd(),
    'api',
    'uploads',
    'attachments',
  );

  public async put(ref: StorageObjectRef, buffer: Buffer): Promise<void> {
    await fs.mkdir(this.attachmentDir, { recursive: true });
    await fs.writeFile(this.pathFor(ref), buffer);
  }

  public async get(ref: StorageObjectRef): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.pathFor(ref));
    } catch {
      return null;
    }
  }

  public async delete(ref: StorageObjectRef): Promise<void> {
    try {
      await fs.unlink(this.pathFor(ref));
    } catch {
      // no-op when file is already missing
    }
  }

  public async exists(ref: StorageObjectRef): Promise<boolean> {
    try {
      await fs.access(this.pathFor(ref));
      return true;
    } catch {
      return false;
    }
  }

  public async reconcile(items: ReconcileItem[]): Promise<void> {
    await fs.mkdir(this.attachmentDir, { recursive: true });

    for (const { ref, filename } of items) {
      if (await this.exists(ref)) {
        continue;
      }
      const placeholder = Buffer.from(
        `Attachment '${filename}' was migrated from legacy storage.\n` +
          `The original binary is not available on disk.\n` +
          `Please re-upload this attachment if you need the original file.\n`,
        'utf-8',
      );
      await fs.writeFile(this.pathFor(ref), placeholder);
    }
  }

  private pathFor(ref: StorageObjectRef): string {
    return path.join(this.attachmentDir, ref.attachmentId);
  }
}
