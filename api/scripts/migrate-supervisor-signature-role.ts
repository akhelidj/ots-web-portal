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
 * Run: npx -y tsx api/scripts/migrate-supervisor-signature-role.ts [--apply]
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'api/.env' });
import { PrismaClient } from '@prisma/client';
import { migrateLegacySupervisorTemplates } from '../src/app/signatures/legacy-supervisor-migration';

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
