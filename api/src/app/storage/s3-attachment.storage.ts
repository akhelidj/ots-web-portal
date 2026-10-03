import { Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  AttachmentStorage,
  ReconcileItem,
  SignatureObjectRef,
  StorageObjectRef,
  TemplateObjectRef,
} from './attachment-storage.types';

export interface S3StorageOptions {
  bucket: string;
  /** Optional attachment key prefix, e.g. `attachments/`. Normalized to end with `/`. */
  prefix: string;
  /**
   * Optional template-workbook key prefix, e.g. `templates/`. Normalized to end
   * with `/`. Keeps template objects namespaced away from attachments in the same
   * bucket. Omitted (undefined) is treated as an empty prefix — the storage module
   * always supplies it in production (default `templates/`).
   */
  templatePrefix?: string;
  /**
   * Optional signature-image key prefix, e.g. `signatures/`. Normalized to end with
   * `/`; omitted is treated as empty (the storage module supplies `signatures/`).
   */
  signaturePrefix?: string;
}

/**
 * S3 attachment backend (phase 1). Objects are keyed hierarchically by the
 * identifiers in scope at upload — `<prefix>tenant/customer/report/attachmentId`
 * — all confirmed available at `addAttachment`. Because the key is deterministic
 * from {@link StorageObjectRef}, download/delete rebuild the same key from the
 * attachment's own row without persisting a separate key column.
 *
 * The download endpoint streams bytes back through the API (phase 1 keeps the
 * JWT-auth'd client contract untouched); presigned URLs are a later optimization.
 */
export class S3AttachmentStorage implements AttachmentStorage {
  private readonly logger = new Logger(S3AttachmentStorage.name);
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly templatePrefix: string;
  private readonly signaturePrefix: string;

  constructor(
    private readonly client: S3Client,
    options: S3StorageOptions,
  ) {
    this.bucket = options.bucket;
    // Normalize: no leading slash, exactly one trailing slash when non-empty.
    this.prefix = S3AttachmentStorage.normalizePrefix(options.prefix);
    this.templatePrefix = S3AttachmentStorage.normalizePrefix(
      options.templatePrefix ?? '',
    );
    this.signaturePrefix = S3AttachmentStorage.normalizePrefix(
      options.signaturePrefix ?? '',
    );
  }

  private static normalizePrefix(prefix: string): string {
    const trimmed = prefix.replace(/^\/+|\/+$/g, '');
    return trimmed.length > 0 ? `${trimmed}/` : '';
  }

  public async put(ref: StorageObjectRef, buffer: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.keyFor(ref),
        Body: buffer,
      }),
    );
  }

  public async get(ref: StorageObjectRef): Promise<Buffer | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.keyFor(ref),
        }),
      );
      if (!response.Body) {
        return null;
      }
      // v3 SDK: the streaming body exposes a helper that drains to bytes.
      const bytes = await response.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (error) {
      if (this.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  public async delete(ref: StorageObjectRef): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: this.keyFor(ref),
        }),
      );
    } catch (error) {
      // S3 DeleteObject is idempotent for a missing key, but tolerate a
      // NotFound just in case a bucket policy surfaces one.
      if (this.isNotFound(error)) {
        return;
      }
      throw error;
    }
  }

  public async exists(ref: StorageObjectRef): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.keyFor(ref),
        }),
      );
      return true;
    } catch (error) {
      if (this.isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * No-op on S3. A per-object HEAD for every attachment on every boot would be
   * expensive and pointless — the S3 backend never writes disk placeholders, and
   * a missing object surfaces as a 404 lazily at download time via {@link get}.
   */
  public async reconcile(items: ReconcileItem[]): Promise<void> {
    if (items.length > 0) {
      this.logger.log(
        `S3 storage: skipping boot-time reconciliation for ${items.length} ` +
          `attachment(s); existence is checked lazily at download.`,
      );
    }
  }

  private keyFor(ref: StorageObjectRef): string {
    const customer = ref.customerId ?? '_no-customer';
    return `${this.prefix}${ref.tenantId}/${customer}/${ref.reportId}/${ref.attachmentId}`;
  }

  // -- Template workbooks ---------------------------------------------------
  //
  // The stored `fileKey` is the backend-agnostic `tenant/templateKey/version`
  // string; the S3 object key adds the template prefix on top of it.

  public buildTemplateKey(ref: TemplateObjectRef): string {
    return `${ref.tenantId}/${ref.templateKey}/${ref.version}`;
  }

  public async putTemplate(fileKey: string, buffer: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.templateKeyFor(fileKey),
        Body: buffer,
      }),
    );
  }

  public async getTemplate(fileKey: string): Promise<Buffer | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.templateKeyFor(fileKey),
        }),
      );
      if (!response.Body) {
        return null;
      }
      const bytes = await response.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (error) {
      if (this.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  public async deleteTemplate(fileKey: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: this.templateKeyFor(fileKey),
        }),
      );
    } catch (error) {
      if (this.isNotFound(error)) {
        return;
      }
      throw error;
    }
  }

  private templateKeyFor(fileKey: string): string {
    return `${this.templatePrefix}${fileKey}`;
  }

  // -- User signatures ------------------------------------------------------
  //
  // The stored key is the backend-agnostic `tenant/user/objectId` string; the S3
  // object key adds the signature prefix on top of it.

  public buildSignatureKey(ref: SignatureObjectRef): string {
    return `${ref.tenantId}/${ref.userId}/${ref.objectId}`;
  }

  public async putSignature(
    storageKey: string,
    buffer: Buffer,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.signatureKeyFor(storageKey),
        Body: buffer,
        ContentType: 'image/png',
      }),
    );
  }

  public async getSignature(storageKey: string): Promise<Buffer | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.signatureKeyFor(storageKey),
        }),
      );
      if (!response.Body) {
        return null;
      }
      const bytes = await response.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (error) {
      if (this.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  public async deleteSignature(storageKey: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: this.signatureKeyFor(storageKey),
        }),
      );
    } catch (error) {
      if (this.isNotFound(error)) {
        return;
      }
      throw error;
    }
  }

  private signatureKeyFor(storageKey: string): string {
    return `${this.signaturePrefix}${storageKey}`;
  }

  private isNotFound(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }
    const name = (error as { name?: string }).name;
    const httpStatus = (
      error as { $metadata?: { httpStatusCode?: number } }
    ).$metadata?.httpStatusCode;
    return (
      name === 'NoSuchKey' ||
      name === 'NotFound' ||
      name === 'NotFoundException' ||
      httpStatus === 404
    );
  }
}
