/**
 * Backfill Template.definitionJson for the single ACTIVE DRILL_PIPE_REPORT row of a
 * tenant from the committed definition file. This is the cutover write that flips a
 * drill-pipe template from the legacy hardcoded paths to the definition engine (approval
 * gate / export / portal form all read the column live when it is present).
 *
 * DRY-RUN BY DEFAULT — validates everything and writes nothing. Pass --apply to write.
 *
 * Guards, all evaluated before any write:
 *   - provenance (git) : the definition file must be tracked
 *                        (`git ls-files --error-unmatch`) AND identical to HEAD in both
 *                        working tree and index (`git diff --exit-code HEAD`). This is
 *                        what guarantees the written value traces to a commit — the point
 *                        on this unversioned column. --allow-dirty skips it (loud warning);
 *                        "differs from HEAD" and "git unavailable" are reported distinctly.
 *   - shape            : parses to an object carrying exactly the required top-level keys
 *                        (fields, disposition, export, transforms, regions, sections),
 *                        with export.global an array, export.regions an object, and
 *                        regions / fields non-empty.
 *   - count            : exactly ONE ACTIVE DRILL_PIPE_REPORT template for <tenantId>,
 *                        else abort — the script never blanket-writes.
 *
 * A breakdown of the parsed file (field/section/transform/region/token counts) is printed
 * before the write so a human can verify it against the known drill-pipe quantities.
 *
 * Idempotent: a row already holding the identical definition (canonical, key-order
 * independent — JSONB does not preserve key order) is left untouched.
 *
 * Run: npx -y tsx api/scripts/backfill-drill-pipe-definition.ts <tenantId> [--apply] [--allow-dirty]
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: 'api/.env' });
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const TEMPLATE_KEY = 'DRILL_PIPE_REPORT';
const DEFINITION_PATH = path.resolve(
  __dirname,
  '../src/app/template/definitions/drill-pipe-v1.definition.json',
);

/** Top-level keys a consumer reads. `rules` is deliberately excluded — no consumer
 *  reads it yet (see ADR-0009 / KNOWN-ISSUES #15), so it is not required here. */
const REQUIRED_KEYS = [
  'fields',
  'disposition',
  'export',
  'transforms',
  'regions',
  'sections',
] as const;

/**
 * Stable, key-sorted stringify — the canonical idiom the round-trip proof uses. Postgres
 * JSONB reorders object keys, so "already the same" must be judged order-independently.
 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}

/** Run git in the definition file's repo; distinguish clean / drift / unavailable. */
function git(args: string[]): {
  status: number | null;
  unavailable: boolean;
  stderr: string;
} {
  const r = spawnSync('git', args, {
    cwd: path.dirname(DEFINITION_PATH),
    encoding: 'utf8',
  });
  if (r.error) return { status: null, unavailable: true, stderr: r.error.message };
  return { status: r.status, unavailable: false, stderr: r.stderr ?? '' };
}

function provenanceGuard(allowDirty: boolean): void {
  if (allowDirty) {
    console.warn(
      '\n**********************************************************************\n' +
        '* --allow-dirty: SKIPPING the git provenance guard.                  *\n' +
        '* The value written is NOT guaranteed to trace to a commit.          *\n' +
        '**********************************************************************',
    );
    return;
  }

  const tracked = git(['ls-files', '--error-unmatch', '--', DEFINITION_PATH]);
  if (tracked.unavailable) {
    throw new Error(
      'provenance guard: git is unavailable, cannot verify the definition traces to a ' +
        'commit. Re-run with --allow-dirty to override.',
    );
  }
  if (tracked.status !== 0) {
    throw new Error(
      `provenance guard: ${DEFINITION_PATH} is not tracked by git. ` +
        'Commit it first, or re-run with --allow-dirty to override.',
    );
  }

  const diff = git(['diff', '--exit-code', 'HEAD', '--', DEFINITION_PATH]);
  if (diff.unavailable) {
    throw new Error(
      'provenance guard: git is unavailable. Re-run with --allow-dirty to override.',
    );
  }
  if (diff.status === 1) {
    throw new Error(
      'provenance guard: the definition file differs from HEAD (uncommitted working-tree ' +
        'or index changes). Commit it first, or re-run with --allow-dirty to override.',
    );
  }
  if (diff.status !== 0) {
    throw new Error(
      `provenance guard: git diff failed (status ${String(diff.status)}: ${diff.stderr.trim()}). ` +
        'Re-run with --allow-dirty to override.',
    );
  }
  console.log('provenance : ok — tracked, working tree + index match HEAD');
}

function shapeGuard(definition: Record<string, unknown>): void {
  const missing = REQUIRED_KEYS.filter((k) => !(k in definition));
  if (missing.length) {
    throw new Error(`shape guard: definition missing required key(s): ${missing.join(', ')}`);
  }
  const exp = definition.export as Record<string, unknown> | undefined;
  if (!Array.isArray(exp?.global)) {
    throw new Error('shape guard: "export.global" must be an array');
  }
  if (!exp?.regions || typeof exp.regions !== 'object' || Array.isArray(exp.regions)) {
    throw new Error('shape guard: "export.regions" must be an object');
  }
  if (!Array.isArray(definition.regions) || definition.regions.length === 0) {
    throw new Error('shape guard: "regions" must be a non-empty array');
  }
  if (!Array.isArray(definition.fields) || definition.fields.length === 0) {
    throw new Error('shape guard: "fields" must be a non-empty array');
  }
}

/** Print a human-verifiable breakdown computed from the parsed file. */
function printBreakdown(definition: Record<string, unknown>): void {
  const fields = definition.fields as Array<Record<string, unknown>>;
  const header = fields.filter((f) => f.scope === 'header');
  const item = fields.filter((f) => f.scope === 'item');
  const itemRequired = item.filter((f) => f.required === true);

  const sections = definition.sections as unknown[];
  const transforms = definition.transforms as Record<string, unknown>;
  const regions = definition.regions as unknown[];

  const exp = definition.export as {
    global: unknown[];
    regions: Record<string, unknown[]>;
  };
  const globalTokens = exp.global.length;
  const perRowTokens = Object.values(exp.regions).reduce(
    (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
    0,
  );

  console.log('\n--- definition breakdown (verify against known drill-pipe quantities) ---');
  console.log(
    `fields     : ${fields.length} total ` +
      `(${header.length} header + ${item.length} item; ${itemRequired.length} item required)`,
  );
  console.log(
    `structure  : ${sections.length} sections, ${Object.keys(transforms).length} transforms, ${regions.length} regions`,
  );
  console.log(`export     : ${globalTokens} global + ${perRowTokens} per-row tokens`);
  console.log('-------------------------------------------------------------------------');
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const allowDirty = args.includes('--allow-dirty');
  const tenantId = args.find((a) => !a.startsWith('--'));

  if (!tenantId) {
    throw new Error(
      'usage: npx -y tsx api/scripts/backfill-drill-pipe-definition.ts <tenantId> [--apply] [--allow-dirty]',
    );
  }

  console.log(`\n=== backfill drill-pipe definitionJson [${apply ? 'APPLY' : 'DRY-RUN'}] ===`);
  console.log(`tenant     : ${tenantId}`);
  console.log(`source     : ${DEFINITION_PATH}`);

  // --- provenance guard (git) ---------------------------------------------------
  provenanceGuard(allowDirty);

  // --- parse + shape guard ------------------------------------------------------
  let definition: Record<string, unknown>;
  try {
    definition = JSON.parse(fs.readFileSync(DEFINITION_PATH, 'utf8')) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`definition file is not valid JSON: ${(e as Error).message}`);
  }
  shapeGuard(definition);
  printBreakdown(definition);

  // --- count guard --------------------------------------------------------------
  const rows = await prisma.template.findMany({
    where: { tenantId, templateKey: TEMPLATE_KEY, status: 'ACTIVE' },
    select: { id: true, templateVersion: true, definitionJson: true },
  });
  if (rows.length !== 1) {
    throw new Error(
      `count guard: expected exactly 1 ACTIVE ${TEMPLATE_KEY} template for tenant ${tenantId}, found ${rows.length}`,
    );
  }
  const target = rows[0];
  console.log(`\ntarget     : template ${target.id} (v${target.templateVersion})`);

  // --- idempotency --------------------------------------------------------------
  const desired = canonical(definition);
  if (target.definitionJson != null && canonical(target.definitionJson) === desired) {
    console.log('row already holds the identical definition — nothing to do.');
    return;
  }

  // --- write (only under --apply) -----------------------------------------------
  if (!apply) {
    console.log('\nDRY-RUN: would populate the column above. Re-run with --apply to write.');
    return;
  }
  const res = await prisma.template.updateMany({
    where: { id: target.id, status: 'ACTIVE' },
    data: { definitionJson: definition as never },
  });
  console.log(`\nAPPLY: updated ${res.count} row(s) — definitionJson is now populated.`);
}

main()
  .catch((e) => {
    console.error(`\nBACKFILL ABORTED: ${(e as Error).message ?? e}`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
