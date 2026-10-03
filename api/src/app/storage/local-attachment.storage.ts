import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  AttachmentStorage,
  ReconcileItem,
  SignatureObjectRef,
  StorageObjectRef,
  TemplateObjectRef,
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
  private readonly templateDir = path.join(
    process.cwd(),
    'api',
    'uploads',
    'templates',
  );
  private readonly signatureDir = path.join(
    process.cwd(),
    'api',
    'uploads',
    'signatures',
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

  // -- Template workbooks ---------------------------------------------------

  public buildTemplateKey(ref: TemplateObjectRef): string {
    return `${ref.tenantId}/${ref.templateKey}/${ref.version}`;
  }

  public async putTemplate(fileKey: string, buffer: Buffer): Promise<void> {
    const target = this.templatePathFor(fileKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer);
  }

  public async getTemplate(fileKey: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.templatePathFor(fileKey));
    } catch {
      return null;
    }
  }

  public async deleteTemplate(fileKey: string): Promise<void> {
    try {
      await fs.unlink(this.templatePathFor(fileKey));
    } catch {
      // no-op when file is already missing
    }
  }

  /**
   * Resolve a template `fileKey` (`tenant/templateKey/version`) to an on-disk
   * path nested under the templates root. The key's segments become directories;
   * they are constrained to a tenant uuid, an alnum/underscore templateKey and an
   * integer version — all path-safe — so no traversal is possible.
   */
  private templatePathFor(fileKey: string): string {
    return path.join(this.templateDir, ...fileKey.split('/'));
  }

  // -- User signatures ------------------------------------------------------

  public buildSignatureKey(ref: SignatureObjectRef): string {
    return `${ref.tenantId}/${ref.userId}/${ref.objectId}`;
  }

  public async putSignature(
    storageKey: string,
    buffer: Buffer,
  ): Promise<void> {
    const target = this.signaturePathFor(storageKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer);
  }

  public async getSignature(storageKey: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.signaturePathFor(storageKey));
    } catch {
      return null;
    }
  }

  public async deleteSignature(storageKey: string): Promise<void> {
    try {
      await fs.unlink(this.signaturePathFor(storageKey));
    } catch {
      // no-op when file is already missing
    }
  }

  /**
   * Resolve a signature key (`tenant/user/objectId`) under the signatures root.
   * Keys are server-minted from uuids, but the path is still checked to stay inside
   * the root: the key is read back from the DB and a corrupted value must never
   * become a traversal.
   */
  private signaturePathFor(storageKey: string): string {
    const resolved = path.resolve(this.signatureDir, ...storageKey.split('/'));
    if (!resolved.startsWith(path.resolve(this.signatureDir) + path.sep)) {
      throw new Error(`Invalid signature storage key '${storageKey}'.`);
    }
    return resolved;
  }
}
