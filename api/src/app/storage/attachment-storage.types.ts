/**
 * Storage abstraction for the app's binary objects. Two implementations sit
 * behind `AttachmentStorage`:
 *   - LocalAttachmentStorage — the historical on-disk behavior, byte-identical
 *     attachment paths (`api/uploads/attachments/<attachmentId>`), plus template
 *     workbooks under `api/uploads/templates/<key>`.
 *   - S3AttachmentStorage — objects keyed hierarchically by the identifiers in
 *     scope at upload time (`<prefix>tenant/customer/report/attachmentId` for
 *     attachments, `<templatePrefix>tenant/templateKey/version` for templates).
 *
 * The backend is chosen at boot from `STORAGE_DRIVER` (see StorageModule); the
 * default is `local`, so local dev and the test suite are unaffected with no env
 * changes.
 *
 * The abstraction covers two object types behind the single interface / driver
 * switch: inspection-report *attachments* (phase 1) and template *workbooks*
 * (phase 2 — migrated off the Postgres `fileBlob`). Attachment methods derive
 * their object location from a {@link StorageObjectRef} each call; template
 * methods take a precomputed string key (persisted on the `Template` row as
 * `fileKey`, built once at create time via {@link AttachmentStorage.buildTemplateKey}).
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

/**
 * Everything a backend needs to build the canonical storage key for a template
 * workbook. All three fields are in scope at `createTemplate`, so the key is
 * computed once there and persisted on the `Template` row (`fileKey`); every
 * read path then loads bytes by that stored key rather than re-deriving it.
 */
export interface TemplateObjectRef {
  tenantId: string;
  templateKey: string;
  version: number;
}

/**
 * Everything needed to mint the storage key of one signature image. `objectId` is a
 * fresh uuid per registration: signature objects are IMMUTABLE and never overwritten,
 * so a key stored on a `ReportSignature` keeps resolving to the exact bytes that were
 * in force at submission even after the user registers a new signature.
 */
export interface SignatureObjectRef {
  tenantId: string;
  userId: string;
  objectId: string;
}

/**
 * Everything needed to mint the storage key of one customer logo. `objectId` is a
 * fresh uuid per upload, so a replaced logo gets a new key (old one deleted) and the
 * key itself doubles as a cache-buster for clients.
 */
export interface LogoObjectRef {
  tenantId: string;
  customerId: string;
  objectId: string;
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

  // -- Template workbooks (phase 2) -----------------------------------------
  //
  // A parallel method set for template objects on the SAME abstraction / driver
  // switch. Unlike attachments, whose location is re-derived from a ref every
  // call, a template's key is built ONCE from a {@link TemplateObjectRef} and
  // persisted as `Template.fileKey`; the read/delete methods take that stored
  // string, so the key is load-bearing and never re-derived from the row.

  /**
   * Build the canonical, backend-agnostic storage key for a template workbook:
   * `<tenantId>/<templateKey>/<version>`. Backends may add their own prefix or
   * on-disk root when they materialize this key; the string returned here is
   * what gets persisted on the `Template` row.
   */
  buildTemplateKey(ref: TemplateObjectRef): string;

  /** Persist a template workbook's `buffer` at `fileKey`, overwriting any existing object. */
  putTemplate(fileKey: string, buffer: Buffer): Promise<void>;

  /** Read a template workbook's bytes by `fileKey`, or `null` when it does not exist. */
  getTemplate(fileKey: string): Promise<Buffer | null>;

  /** Remove the template workbook at `fileKey`; a no-op when it is already gone. */
  deleteTemplate(fileKey: string): Promise<void>;

  // -- User signatures ------------------------------------------------------
  //
  // Same model as templates: the key is built once at registration and persisted
  // (`UserSignature.storageKey`, copied onto `ReportSignature.storageKey` at
  // submission); reads take that stored string.

  /** Build the backend-agnostic key `<tenantId>/<userId>/<objectId>` for a signature PNG. */
  buildSignatureKey(ref: SignatureObjectRef): string;

  /** Persist a signature image's `buffer` at `storageKey`. */
  putSignature(storageKey: string, buffer: Buffer): Promise<void>;

  /** Read a signature image by `storageKey`, or `null` when it does not exist. */
  getSignature(storageKey: string): Promise<Buffer | null>;

  /** Remove the signature object at `storageKey`; a no-op when it is already gone. */
  deleteSignature(storageKey: string): Promise<void>;

  // -- Customer logos (branding) --------------------------------------------
  //
  // Same model as signatures: key built once at upload, persisted on
  // `Customer.logoKey`, reads take that stored string.

  /** Build the backend-agnostic key `<tenantId>/<customerId>/<objectId>` for a logo. */
  buildLogoKey(ref: LogoObjectRef): string;

  /** Persist a logo image's `buffer` at `storageKey`. */
  putLogo(storageKey: string, buffer: Buffer, contentType: string): Promise<void>;

  /** Read a logo image by `storageKey`, or `null` when it does not exist. */
  getLogo(storageKey: string): Promise<Buffer | null>;

  /** Remove the logo object at `storageKey`; a no-op when it is already gone. */
  deleteLogo(storageKey: string): Promise<void>;
}
