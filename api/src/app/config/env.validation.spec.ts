import { validateEnv } from './env.validation';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  JWT_ACCESS_SECRET: 'a-secret',
};

describe('validateEnv', () => {
  it('accepts the minimal valid environment', () => {
    expect(validateEnv(valid)).toBe(valid);
  });

  it('lists every problem at once', () => {
    expect(() => validateEnv({})).toThrow(
      /DATABASE_URL is required[\s\S]*JWT_ACCESS_SECRET is required/,
    );
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: 'mysql://x' })).toThrow(
      /postgres/,
    );
  });

  it('rejects malformed numbers but allows them unset', () => {
    expect(() => validateEnv({ ...valid, PORT: 'abc' })).toThrow(/PORT/);
    expect(() =>
      validateEnv({ ...valid, JWT_ACCESS_TTL_SECONDS: '0' }),
    ).toThrow(/JWT_ACCESS_TTL_SECONDS/);
    expect(() => validateEnv({ ...valid, PORT: '3000' })).not.toThrow();
  });

  it('validates the storage driver and its s3 requirements', () => {
    expect(() => validateEnv({ ...valid, STORAGE_DRIVER: 'ftp' })).toThrow(
      /STORAGE_DRIVER/,
    );
    expect(() => validateEnv({ ...valid, STORAGE_DRIVER: 's3' })).toThrow(
      /S3_BUCKET[\s\S]*S3_REGION/,
    );
    expect(() =>
      validateEnv({
        ...valid,
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'b',
        AWS_REGION: 'eu-west-1',
      }),
    ).not.toThrow();
  });

  it('only warns about a short secret in production', () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    expect(() =>
      validateEnv({ ...valid, NODE_ENV: 'production' }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
