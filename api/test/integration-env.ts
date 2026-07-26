/**
 * Integration-test DB bootstrap and SAFETY GUARD.
 *
 * This is the single gate that decides which database the API integration tests
 * talk to. It is imported by both the Jest `globalSetup` (schema push) and
 * `setupFiles` (per-worker, before PrismaClient is constructed).
 *
 * Guarantees:
 *   1. It loads ONLY `api/.env.test` — never `api/.env` — so a test run can never
 *      inherit the app's real DATABASE_URL.
 *   2. If `TEST_DATABASE_URL` is absent, it THROWS with a clear message. There is
 *      no fallback to DATABASE_URL or any other source.
 *   3. It refuses any database whose name does not end in `_test`, so even a
 *      mis-set URL cannot point the tests at a dev/prod database.
 *   4. Only after those checks does it set `process.env.DATABASE_URL`, overwriting
 *      any inherited value, so Prisma connects to the validated test DB and
 *      nothing else.
 *
 * It does not modify application code: PrismaService still reads
 * `env("DATABASE_URL")` exactly as before — this file just controls that env var
 * for the test process before the client is created.
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

const ENV_TEST_PATH = resolve(__dirname, '..', '.env.test');

// Load ONLY api/.env.test. `override: true` guarantees a stray DATABASE_URL/
// TEST_DATABASE_URL already in the shell cannot shadow the test file.
loadEnv({ path: ENV_TEST_PATH, override: true });

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error(
    [
      'TEST_DATABASE_URL is not set — refusing to run API integration tests.',
      `Expected it in ${ENV_TEST_PATH} (copy api/.env.test.example).`,
      'These tests NEVER fall back to the app DATABASE_URL; fix the test env instead.',
    ].join('\n'),
  );
}

// Second, independent safety net: the target DB name must end in `_test`.
let testDbName: string;
try {
  testDbName = new URL(testDatabaseUrl).pathname.replace(/^\//, '');
} catch {
  throw new Error(
    `TEST_DATABASE_URL is not a valid URL — refusing to run integration tests.`,
  );
}

if (!/_test$/.test(testDbName)) {
  throw new Error(
    [
      `Refusing to run integration tests against database "${testDbName}".`,
      'The test database name must end in "_test" (e.g. ots_test).',
      'This guard prevents tests from ever touching a dev or prod database.',
    ].join('\n'),
  );
}

// Only now hand the validated URL to Prisma, overwriting any inherited value.
process.env.DATABASE_URL = testDatabaseUrl;

// Redacted target, so runs/CI logs show which DB was resolved without leaking creds.
const redactedTarget = `${new URL(testDatabaseUrl).host}/${testDbName}`;
// eslint-disable-next-line no-console
console.log(
  `[integration-env] tests resolved to test database: ${redactedTarget}`,
);

export const TEST_DATABASE_URL = testDatabaseUrl;
export const TEST_DATABASE_NAME = testDbName;
