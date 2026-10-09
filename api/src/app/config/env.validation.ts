/**
 * Fail-fast validation of the process environment, run once by ConfigModule at boot.
 * A missing or malformed value stops the API with one clear message instead of surfacing
 * as an obscure error on first use.
 */
export type Env = Record<string, string | undefined>;

const POSITIVE_INTS = [
  'PORT',
  'JWT_ACCESS_TTL_SECONDS',
  'REFRESH_TOKEN_TTL_DAYS',
] as const;

export function validateEnv(env: Env): Env {
  const problems: string[] = [];
  const has = (key: string) => !!env[key]?.trim();

  if (!has('DATABASE_URL')) {
    problems.push('DATABASE_URL is required');
  } else if (!/^postgres(ql)?:\/\//.test(env['DATABASE_URL']!.trim())) {
    problems.push('DATABASE_URL must be a postgres:// or postgresql:// URL');
  }

  if (!has('JWT_ACCESS_SECRET')) {
    problems.push('JWT_ACCESS_SECRET is required');
  } else if (
    env['NODE_ENV'] === 'production' &&
    env['JWT_ACCESS_SECRET']!.length < 32
  ) {
    // A warning, not a failure: refusing to boot would turn a weak-but-working deployment
    // into an outage. Rotate it to 32+ random characters.
    console.warn(
      'JWT_ACCESS_SECRET is shorter than 32 characters; use a long random value in production.',
    );
  }

  for (const key of POSITIVE_INTS) {
    const raw = env[key];
    if (raw !== undefined && raw !== '' && !/^[1-9]\d*$/.test(raw.trim())) {
      problems.push(`${key} must be a positive integer (got "${raw}")`);
    }
  }

  const driver = env['STORAGE_DRIVER']?.trim() || 'local';
  if (driver !== 'local' && driver !== 's3') {
    problems.push(`STORAGE_DRIVER must be "local" or "s3" (got "${driver}")`);
  }
  if (driver === 's3') {
    if (!has('S3_BUCKET'))
      problems.push('S3_BUCKET is required when STORAGE_DRIVER=s3');
    if (!has('S3_REGION') && !has('AWS_REGION')) {
      problems.push(
        'S3_REGION (or AWS_REGION) is required when STORAGE_DRIVER=s3',
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n - ${problems.join('\n - ')}`,
    );
  }
  return env;
}
