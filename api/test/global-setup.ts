/**
 * Jest globalSetup for API integration tests — runs once before the suite.
 *
 * Importing ./integration-env applies the safety guard (see that file) and sets
 * process.env.DATABASE_URL to the validated test DB. We then create/reset the test
 * schema from the CURRENT Prisma schema with `prisma db push --force-reset`.
 *
 * Why `db push` (not `migrate deploy`): the test DB is disposable, so we want the
 * schema synced directly from schema.prisma, fast, and fully reset each run.
 * `--force-reset` drops and recreates the schema so every run starts pristine.
 * (If we later want to also catch migration drift, add a `migrate deploy` variant.)
 */
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { TEST_DATABASE_NAME } from './integration-env';

export default async function globalSetup(): Promise<void> {
  const schemaPath = resolve(__dirname, '..', 'prisma', 'schema.prisma');

  // eslint-disable-next-line no-console
  console.log(
    `[global-setup] resetting test schema in "${TEST_DATABASE_NAME}" via prisma db push`,
  );

  execSync(
    `npx prisma db push --force-reset --skip-generate --schema "${schemaPath}"`,
    {
      stdio: 'inherit',
      env: process.env, // DATABASE_URL already points at the validated test DB
    },
  );
}
