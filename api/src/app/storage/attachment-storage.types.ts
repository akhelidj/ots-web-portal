/**
 * Storage abstraction for inspection-report attachment binaries (S3 migration
 * phase 1). Two implementations sit behind `AttachmentStorage`:
 *   - LocalAttachmentStorage — the historical on-disk behavior, byte-identical
 *     paths (`api/uploads/attachments/<attachmentId>`).
 *   - S3AttachmentStorage — objects keyed hierarchically by the identifiers in
 *     scope at upload time (`<prefix>tenant/customer/report/attachmentId`).
 *
 * The backend is chosen at boot from `STORAGE_DRIVER` (see StorageModule); the
 * default is `local`, so local dev and the test suite are unaffected with no env
 * changes. Templates (the DB `fileBlob`) are explicitly out of scope for phase 1.
 */

/** DI token for the selected {@link AttachmentStorage} implementation. */
export const ATTACHMENT_STORAGE = 'ATTACHMENT_STORAGE';

/**
 * Everything a backend needs to locate an attachment's bytes. The physical
 * location is derived deterministically from these fields, so any caller that
 * can look the attachment up (upload, download, delete, reconciliation) can
 * rebuild the same reference. The local backend keys on `attachmentId` alone;
 * the S3 backend uses the full hierarchy.
 */
export interface StorageObjectRef {
  tenantId: string;
  /** Reports may have a null customer (`onDelete: SetNull`). */
  customerId: string | null;
  reportId: string;
  attachmentId: string;
}

/** One attachment presented to the boot-time reconciliation pass. */
export interface ReconcileItem {
  ref: StorageObjectRef;
  filename: string;
}

export interface AttachmentStorage {
  /** Persist `buffer` at the location for `ref`, overwriting any existing object. */
  put(ref: StorageObjectRef, buffer: Buffer): Promise<void>;

  /** Read the bytes for `ref`, or `null` when the object does not exist. */
  get(ref: StorageObjectRef): Promise<Buffer | null>;

  /** Remove the object for `ref`; a no-op when it is already gone. */
  delete(ref: StorageObjectRef): Promise<void>;

  /** Whether an object currently exists at the location for `ref`. */
  exists(ref: StorageObjectRef): Promise<boolean>;

  /**
   * Boot-time storage reconciliation (called from FilesService.onModuleInit).
   * The local backend materializes a placeholder for any attachment whose binary
   * is missing on disk; the S3 backend treats this as a no-op (a per-object HEAD
   * for every attachment on every boot would be needlessly expensive — existence
   * is checked lazily at download time instead). URL normalization in the DB is
   * handled by FilesService and is independent of the backend.
   */
  reconcile(items: ReconcileItem[]): Promise<void>;
}
