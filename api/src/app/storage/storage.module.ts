import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import {
  ATTACHMENT_STORAGE,
  AttachmentStorage,
} from './attachment-storage.types';
import { LocalAttachmentStorage } from './local-attachment.storage';
import { S3AttachmentStorage } from './s3-attachment.storage';

/**
 * Selects the attachment storage backend at boot from `STORAGE_DRIVER`
 * (`local` | `s3`, default `local`). Global so the single selected instance is
 * shared by every FilesService (the service is provided in more than one module).
 *
 * Env vars — the user sets the secrets; we only read them:
 *   STORAGE_DRIVER          local | s3            (default: local)
 *   S3_BUCKET               bucket name           (required when driver=s3)
 *   S3_REGION               AWS region            (falls back to AWS_REGION)
 *   S3_PREFIX               optional attachment key prefix   (e.g. attachments/)
 *   S3_TEMPLATE_PREFIX      optional template key prefix     (default: templates/)
 *   AWS_ACCESS_KEY_ID       standard AWS creds — read by the SDK's default
 *   AWS_SECRET_ACCESS_KEY   credential provider chain, never by this code.
 */
export function createAttachmentStorage(
  config: ConfigService,
): AttachmentStorage {
  const driver = (config.get<string>('STORAGE_DRIVER') ?? 'local')
    .trim()
    .toLowerCase();

  if (driver === 's3') {
    const bucket = config.get<string>('S3_BUCKET')?.trim();
    if (!bucket) {
      throw new Error(
        'STORAGE_DRIVER=s3 requires S3_BUCKET to be set in the environment.',
      );
    }
    const region =
      config.get<string>('S3_REGION')?.trim() ||
      config.get<string>('AWS_REGION')?.trim();
    if (!region) {
      throw new Error(
        'STORAGE_DRIVER=s3 requires S3_REGION (or AWS_REGION) to be set.',
      );
    }
    const prefix = config.get<string>('S3_PREFIX')?.trim() ?? '';
    // Templates default to their own `templates/` namespace so they never collide
    // with attachment objects in the same bucket.
    const templatePrefix =
      config.get<string>('S3_TEMPLATE_PREFIX')?.trim() ?? 'templates/';

    // Credentials are resolved by the AWS SDK's default provider chain
    // (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / instance role) — never handled
    // here, so no secret ever passes through application code.
    const client = new S3Client({ region });
    new Logger('StorageModule').log(
      `Storage driver: s3 (bucket=${bucket}, region=${region}` +
        `${prefix ? `, prefix=${prefix}` : ''}, templatePrefix=${templatePrefix}).`,
    );
    return new S3AttachmentStorage(client, { bucket, prefix, templatePrefix });
  }

  if (driver !== 'local') {
    throw new Error(
      `Unknown STORAGE_DRIVER='${driver}'. Expected 'local' or 's3'.`,
    );
  }

  new Logger('StorageModule').log('Storage driver: local (disk).');
  return new LocalAttachmentStorage();
}

@Global()
@Module({
  providers: [
    {
      provide: ATTACHMENT_STORAGE,
      useFactory: createAttachmentStorage,
      inject: [ConfigService],
    },
  ],
  exports: [ATTACHMENT_STORAGE],
})
export class StorageModule {}
