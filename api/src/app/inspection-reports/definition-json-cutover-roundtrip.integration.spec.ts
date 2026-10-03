/**
 * CUTOVER ACCEPTANCE TEST — definitionJson round-trip equivalence.
 *
 * Proves that the committed drill-pipe definition, after a REAL DB write into
 * Template.definitionJson and a read-back through each of the three delivery paths,
 * is byte-equivalent (canonically) to the on-disk drill-pipe-v1.definition.json the
 * phase proofs (approval-gate / export-engine / definition-to-form-schema) ran
 * against. If any path coerces, reorders, or drops content, the cutover is unsafe.
 *
 * The three paths, each asserted deep-equal to the committed file:
 *   1. GATE   — the value engineGate's caller reads
 *               (inspection-report-workflow.service.ts:311-322).
 *   2. EXPORT — the value export.service.ts reads off the loaded row
 *               (export.service.ts:258-287).
 *   3. PORTAL — getReports() Template-join + the extra HTTP hop
 *               (inspection-reports.service.ts:59-92 → JSON serialize → Angular parse).
 *
 * JSONB does not preserve key order, so equivalence is compared with a canonical,
 * key-sorted stringify (same idiom as the backfill script) — a naive JSON.stringify
 * compare would report false mismatches.
 *
 * The column is seeded the SAME way the backfill script does — read the committed
 * file, write the parsed object to the ACTIVE drill-pipe row — so the proof exercises
 * the real write path, not a hand-built object. Runs against the dedicated test
 * Postgres (:5433); this spec never touches the real dev/prod row.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InspectionReportsService } from './inspection-reports.service';
import {
  seedTenant,
  seedActiveTemplate,
  seedInspectionReport,
  resetInspectionDomain,
  makeFilesServiceStub,
} from '../../../test/seed-helpers';

const TEMPLATE_KEY = 'DRILL_PIPE_REPORT';
const DEFINITION_PATH = resolve(
  __dirname,
  '../template/definitions/drill-pipe-v1.definition.json',
);

/**
 * Stable, key-sorted stringify — the canonical idiom reused from the backfill
 * script. Postgres JSONB reorders object keys, so structural equality must be
 * compared on a form that is invariant to key order.
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

/** Read + parse the committed definition file exactly as the backfill script does. */
function readCommittedDefinition(): Record<string, unknown> {
  return JSON.parse(readFileSync(DEFINITION_PATH, 'utf8'));
}

/** The committed file's canonical form — the fixed point every path must reproduce. */
const COMMITTED_CANON = canonical(readCommittedDefinition());

describe('definitionJson cutover round-trip equivalence [integration]', () => {
  let prisma: PrismaService;
  let service: InspectionReportsService;

  const admin = (tenantId: string) => ({
    tenantId,
    role: UserRole.ADMIN,
    customerId: null,
  });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    service = new InspectionReportsService(prisma, makeFilesServiceStub());
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  let tenantId: string;

  beforeEach(async () => {
    await resetInspectionDomain(prisma);
    const tenant = await seedTenant(prisma);
    tenantId = tenant.id;
    // ACTIVE drill-pipe template starting with definitionJson NULL (opt out of the
    // seeder default) — each test then writes its own definition via writeDefinition()
    // and reads it back, so the NULL start is the roundtrip's precondition.
    await seedActiveTemplate(prisma, tenantId, TEMPLATE_KEY, {
      definitionJson: null,
    });
    await seedInspectionReport(prisma, tenantId);
  });

  /**
   * Seed the column the backfill way: write the given (file-derived) object to the
   * one ACTIVE drill-pipe row. `as never` matches the repo's convention for writing
   * a Json column in tests.
   */
  async function writeDefinition(def: unknown): Promise<void> {
    await prisma.template.updateMany({
      where: { tenantId, templateKey: TEMPLATE_KEY, status: 'ACTIVE' },
      data: { definitionJson: def as never },
    });
  }

  // --- read-back paths, each mirroring the real consumer's row load exactly ------

  /** GATE: inspection-report-workflow.service.ts:311-322. */
  async function readViaGatePath(): Promise<unknown> {
    const template = await prisma.template.findUnique({
      where: {
        tenantId_templateKey_templateVersion: {
          tenantId,
          templateKey: TEMPLATE_KEY,
          templateVersion: 1,
        },
      },
      select: { definitionJson: true },
    });
    return (template?.definitionJson as unknown) ?? null;
  }

  /** EXPORT: export.service.ts:258-287 (full row loaded, definition read off it). */
  async function readViaExportPath(): Promise<unknown> {
    const template = await prisma.template.findUnique({
      where: {
        tenantId_templateKey_templateVersion: {
          tenantId,
          templateKey: TEMPLATE_KEY,
          templateVersion: 1,
        },
      },
    });
    return (template!.definitionJson as unknown) ?? null;
  }

  /**
   * PORTAL: getReports() attaches definitionJson via the Template join
   * (inspection-reports.service.ts:59-92), then the payload crosses the wire —
   * JSON.stringify (server) → JSON.parse (Angular HttpClient). This is the only
   * path with an extra serialize/parse cycle on top of Prisma's JSONB decode, so
   * it is the one most likely to surface a coercion or ordering difference.
   */
  async function readViaPortalPath(): Promise<unknown> {
    const reports = await service.getReports(admin(tenantId));
    // Model the HTTP hop the exact way Angular receives it.
    const overTheWire = JSON.parse(JSON.stringify(reports));
    return (overTheWire[0] as { definitionJson: unknown }).definitionJson;
  }

  // === EQUIVALENCE: each path reproduces the committed file exactly ==============

  it('GATE path read-back is canonically equal to the committed definition', async () => {
    await writeDefinition(readCommittedDefinition());
    expect(canonical(await readViaGatePath())).toBe(COMMITTED_CANON);
  });

  it('EXPORT path read-back is canonically equal to the committed definition', async () => {
    await writeDefinition(readCommittedDefinition());
    expect(canonical(await readViaExportPath())).toBe(COMMITTED_CANON);
  });

  it('PORTAL path read-back (Prisma → HTTP serialize → Angular parse) is canonically equal to the committed definition', async () => {
    await writeDefinition(readCommittedDefinition());
    expect(canonical(await readViaPortalPath())).toBe(COMMITTED_CANON);
  });

  // === MUTATION GUARDS: a corrupted column must FAIL every read-back =============
  // A proof that cannot fail is vacuous. One value-mutation, one structural-mutation.

  it('VALUE mutation (flip a required field value) makes all three read-backs FAIL equivalence', async () => {
    const mutated = readCommittedDefinition();
    // Flip the first field's `required` flag — a real value change, same shape.
    const fields = mutated.fields as Array<{ required: boolean }>;
    fields[0].required = !fields[0].required;
    await writeDefinition(mutated);

    expect(canonical(await readViaGatePath())).not.toBe(COMMITTED_CANON);
    expect(canonical(await readViaExportPath())).not.toBe(COMMITTED_CANON);
    expect(canonical(await readViaPortalPath())).not.toBe(COMMITTED_CANON);
  });

  it('STRUCTURAL mutation (drop a required top-level key) makes all three read-backs FAIL equivalence', async () => {
    const mutated = readCommittedDefinition();
    // Drop `disposition` — a top-level key the gate consumer reads.
    delete mutated.disposition;
    await writeDefinition(mutated);

    expect(canonical(await readViaGatePath())).not.toBe(COMMITTED_CANON);
    expect(canonical(await readViaExportPath())).not.toBe(COMMITTED_CANON);
    expect(canonical(await readViaPortalPath())).not.toBe(COMMITTED_CANON);
  });
});
