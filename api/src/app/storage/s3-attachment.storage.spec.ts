// Unit spec for the S3 attachment storage backend, exercised against a mocked
// S3 client. The real-bucket round-trip waits on the user's credentials; this
// suite proves the logic now — object-key construction, that put/get/delete/
// exists issue the right SDK commands with the right params, and the not-found
// and config-missing cases.

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { S3AttachmentStorage } from './s3-attachment.storage';
import { LocalAttachmentStorage } from './local-attachment.storage';
import { createAttachmentStorage } from './storage.module';
import { StorageObjectRef } from './attachment-storage.types';

function makeRef(overrides: Partial<StorageObjectRef> = {}): StorageObjectRef {
  return {
    tenantId: 'tenant-1',
    customerId: 'customer-1',
    reportId: 'report-1',
    attachmentId: 'att-1',
    ...overrides,
  };
}

/** A mock S3Client whose `send` is a jest.fn we assert against. */
function makeMockClient(): { client: S3Client; send: jest.Mock } {
  const send = jest.fn();
  const client = { send } as unknown as S3Client;
  return { client, send };
}

/** Build the shape S3 v3 returns from GetObject (a streaming Body). */
function getResult(bytes: Uint8Array) {
  return {
    Body: { transformToByteArray: async () => bytes },
  };
}

function notFoundError(name = 'NoSuchKey') {
  return { name, $metadata: { httpStatusCode: 404 } };
}

describe('S3AttachmentStorage', () => {
  describe('object key construction', () => {
    it('keys objects by prefix/tenant/customer/report/attachmentId', async () => {
      const { client, send } = makeMockClient();
      const storage = new S3AttachmentStorage(client, {
        bucket: 'my-bucket',
        prefix: 'attachments/',
      });

      await storage.put(makeRef(), Buffer.from('x'));

      const command = send.mock.calls[0][0] as PutObjectCommand;
      expect(command.input.Key).toBe(
        'attachments/tenant-1/customer-1/report-1/att-1',
      );
      expect(command.input.Bucket).toBe('my-bucket');
    });

    it('substitutes _no-customer when the report has no customer', async () => {
      const { client, send } = makeMockClient();
      const storage = new S3AttachmentStorage(client, {
        bucket: 'b',
        prefix: '',
      });

      await storage.put(makeRef({ customerId: null }), Buffer.from('x'));

      const command = send.mock.calls[0][0] as PutObjectCommand;
      expect(command.input.Key).toBe('tenant-1/_no-customer/report-1/att-1');
    });

    it('normalizes an unslashed / over-slashed prefix to a single trailing slash', async () => {
      for (const prefix of ['foo', '/foo', 'foo/', '/foo/']) {
        const { client, send } = makeMockClient();
        const storage = new S3AttachmentStorage(client, {
          bucket: 'b',
          prefix,
        });
        await storage.put(makeRef(), Buffer.from('x'));
        const command = send.mock.calls[0][0] as PutObjectCommand;
        expect(command.input.Key).toBe(
          'foo/tenant-1/customer-1/report-1/att-1',
        );
      }
    });
  });

  describe('put', () => {
    it('sends a PutObjectCommand with the buffer as Body', async () => {
      const { client, send } = makeMockClient();
      const storage = new S3AttachmentStorage(client, {
        bucket: 'b',
        prefix: '',
      });
      const buffer = Buffer.from('payload');

      await storage.put(makeRef(), buffer);

      const command = send.mock.calls[0][0];
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input.Body).toBe(buffer);
    });
  });

  describe('get', () => {
    it('sends a GetObjectCommand and returns the drained bytes as a Buffer', async () => {
      const { client, send } = makeMockClient();
      const bytes = new Uint8Array([1, 2, 3, 4]);
      send.mockResolvedValueOnce(getResult(bytes));
      const storage = new S3AttachmentStorage(client, {
        bucket: 'b',
        prefix: '',
      });

      const result = await storage.get(makeRef());

      expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
      expect(result).not.toBeNull();
      expect(result!.equals(Buffer.from(bytes))).toBe(true);
    });

    it('returns null on a NoSuchKey error instead of throwing', async () => {
      const { client, send } = makeMockClient();
      send.mockRejectedValueOnce(notFoundError('NoSuchKey'));
      const storage = new S3AttachmentStorage(client, {
        bucket: 'b',
        prefix: '',
      });

      expect(await storage.get(makeRef())).toBeNull();
    });

    it('rethrows a non-404 error', async () => {
      const { client, send } = makeMockClient();
      send.mockRejectedValueOnce({
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      });
      const storage = new S3AttachmentStorage(client, {
        bucket: 'b',
        prefix: '',
      });

      await expect(storage.get(makeRef())).rejects.toMatchObject({
        name: 'AccessDenied',
      });
    });
  });

  describe('delete', () => {
    it('sends a DeleteObjectCommand', async () => {
      const { client, send } = makeMockClient();
      const storage = new S3AttachmentStorage(client, {
        bucket: 'b',
        prefix: '',
      });

      await storage.delete(makeRef());

      const command = send.mock.calls[0][0];
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      expect(command.input.Key).toBe('tenant-1/customer-1/report-1/att-1');
    });

    it('tolerates a NotFound and does not throw', async () => {
      const { client, send } = makeMockClient();
      send.mockRejectedValueOnce(notFoundError('NotFound'));
      const storage = new S3AttachmentStorage(client, {
        bucket: 'b',
        prefix: '',
      });

      await expect(storage.delete(makeRef())).resolves.toBeUndefined();
    });
  });

  describe('exists', () => {
    it('returns true when HeadObject succeeds', async () => {
      const { client, send } = makeMockClient();
      send.mockResolvedValueOnce({});
      const storage = new S3AttachmentStorage(client, {
        bucket: 'b',
        prefix: '',
      });

      expect(await storage.exists(makeRef())).toBe(true);
      expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
    });

    it('returns false when HeadObject 404s', async () => {
      const { client, send } = makeMockClient();
      send.mockRejectedValueOnce(notFoundError('NotFound'));
      const storage = new S3AttachmentStorage(client, {
        bucket: 'b',
        prefix: '',
      });

      expect(await storage.exists(makeRef())).toBe(false);
    });
  });

  describe('reconcile', () => {
    it('is a no-op — never touches S3 on boot', async () => {
      const { client, send } = makeMockClient();
      const storage = new S3AttachmentStorage(client, {
        bucket: 'b',
        prefix: '',
      });

      await storage.reconcile([
        { ref: makeRef(), filename: 'a.pdf' },
        { ref: makeRef({ attachmentId: 'att-2' }), filename: 'b.pdf' },
      ]);

      expect(send).not.toHaveBeenCalled();
    });
  });
});

describe('createAttachmentStorage — backend selection', () => {
  function config(values: Record<string, string | undefined>): ConfigService {
    return {
      get: (key: string) => values[key],
    } as unknown as ConfigService;
  }

  it('defaults to the local backend when STORAGE_DRIVER is unset', () => {
    expect(createAttachmentStorage(config({}))).toBeInstanceOf(
      LocalAttachmentStorage,
    );
  });

  it('selects the S3 backend when STORAGE_DRIVER=s3 with full config', () => {
    const storage = createAttachmentStorage(
      config({
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'my-bucket',
        S3_REGION: 'us-east-1',
        S3_PREFIX: 'attachments/',
      }),
    );
    expect(storage).toBeInstanceOf(S3AttachmentStorage);
  });

  it('throws when STORAGE_DRIVER=s3 but S3_BUCKET is missing', () => {
    expect(() =>
      createAttachmentStorage(
        config({ STORAGE_DRIVER: 's3', S3_REGION: 'us-east-1' }),
      ),
    ).toThrow(/S3_BUCKET/);
  });

  it('throws when STORAGE_DRIVER=s3 but no region is resolvable', () => {
    expect(() =>
      createAttachmentStorage(
        config({ STORAGE_DRIVER: 's3', S3_BUCKET: 'my-bucket' }),
      ),
    ).toThrow(/S3_REGION/);
  });

  it('falls back to AWS_REGION when S3_REGION is unset', () => {
    const storage = createAttachmentStorage(
      config({
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'my-bucket',
        AWS_REGION: 'eu-west-1',
      }),
    );
    expect(storage).toBeInstanceOf(S3AttachmentStorage);
  });

  it('throws on an unknown driver', () => {
    expect(() =>
      createAttachmentStorage(config({ STORAGE_DRIVER: 'azure' })),
    ).toThrow(/Unknown STORAGE_DRIVER/);
  });
});
