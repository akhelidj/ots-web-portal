/**
 * Migrate legacy SUPERVISOR-signer `signature` fields onto the `supervisorSignature`
 * SYSTEM role (ADR-0012). The logic lives in
 * `src/app/signatures/legacy-supervisor-migration.ts` (unit + integration tested); this is
 * the CLI around it.
 *
 * Per Template whose stored definition still carries a `signature` field with
 * `signer: 'SUPERVISOR'`:
 *   - the FIRST such field becomes the role field (`type: 'text'`, `role:
 *     'supervisorSignature'`) and its export entry `{ token, computed: 'supervisorSignature' }`
 *     — same cell, same picture; any further legacy field is dropped and its export entry
 *     re-pointed at the role's picture;
 *   - the prior definition is appended to TemplateDefinitionRevision;
 *   - the frozen report signatures of the replaced slot(s) are COPIED to the
 *     `supervisorSignature` slot (same revision/object/hash/time) for the reports pinned to
 *     that template version. Originals are never deleted.
 *
 * DRY-RUN BY DEFAULT. Idempotent. One transaction per template.
 *
 * Run (dev):  npx -y tsx api/scripts/migrate-supervisor-signature-role.ts [--apply]
 * Run (prod): `npm run db:migrate:supervisor-role:build` bundles it to
 *   dist/api/scripts/migrate-supervisor-signature-role.js, shipped with api_dist; then
 *   `docker exec ots_api node scripts/migrate-supervisor-signature-role.js [--apply]`.
 */
import { PrismaClient } from '@prisma/client';
import { migrateLegacySupervisorTemplates } from '../src/app/signatures/legacy-supervisor-migration';

// Local runs read api/.env; inside the API container the environment is already set (and
// `dotenv` is not a runtime dependency there), so this is best-effort.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ path: 'api/.env' });
} catch {
  /* env already provided */
}

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
console.log(apply ? '== APPLY ==' : '== DRY RUN (pass --apply to write) ==');

migrateLegacySupervisorTemplates(prisma, { apply, log: console.log })
  .then(({ migrated }) =>
    console.log(
      apply ? `Migrated ${migrated} template(s).` : 'Dry run complete — nothing written.',
    ),
  )
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
