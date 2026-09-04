/**
 * Phase D — durable definition-edit history (option b) [integration].
 *
 * Proves the clobber gap is closed: every `PUT /templates/:id/definition` write appends a
 * revision preserving the PRIOR definition, restore round-trips reversibly through the same
 * validation gate, and the token-set signature classifies each edit cosmetic vs structural.
 * The mechanism keys purely on `templateId` — no template type is special-cased.
 *
 * Runs under `test-integration` against the dedicated test Postgres (:5433).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateDefinitionService } from './template-definition.service';
import { XlsNormalizerService } from './xls-normalizer.service';
import { TokenExtractorService } from './token-extractor.service';
import { DefineTemplateDto } from './definition-authoring.types';
import { resetInspectionDomain, seedTenant } from '../../../test/seed-helpers';

const REAL_TEMPLATE_BYTES = readFileSync(
  resolve(__dirname, '../../../scripts/valid-template.xlsx'),
);

/**
 * A valid ops description over tokens that really exist in the fixture. `displayName` tags
 * the edit so a stored revision can be identified; `dropBod` removes the `{{b_od}}` field
 * to change the TOKEN SET (a structural edit) vs a pure relabel (cosmetic).
 */
function dto(displayName: string, opts: { dropBod?: boolean } = {}): DefineTemplateDto {
  // Fully roled: all six header roles + the item serialNumber, so every edit clears the
  // mandatory-role gate. The `{{poNumber}}` label varies per edit (the cosmetic dimension);
  // dropping `{{b_od}}` changes the TOKEN SET (the structural dimension) while every role
  // stays mapped — so a structural edit is still a valid save.
  const fields: DefineTemplateDto['fields'] = [
    { token: '{{customer}}', label: 'Customer', type: 'text', required: false, scope: 'header', role: 'customer' },
    { token: '{{reportNumber}}', label: 'Report Number', type: 'text', required: false, scope: 'header', role: 'reportNumber' },
    {
      token: '{{poNumber}}',
      label: `PO ${displayName}`, // label varies per edit (cosmetic dimension)
      type: 'text',
      required: false,
      scope: 'header',
      role: 'poNumber',
    },
    { token: '{{inspectedBy}}', label: 'Inspector', type: 'text', required: false, scope: 'header', role: 'inspector' },
    { token: '{{approvedBy}}', label: 'Supervisor', type: 'text', required: false, scope: 'header', role: 'supervisor' },
    { token: '{{reportDate}}', label: 'Report Date', type: 'date', required: false, scope: 'header', role: 'inspectionDate' },
    { token: '{{sn}}', label: 'Serial Number', type: 'text', required: false, scope: 'item', role: 'serialNumber' },
    {
      token: '{{emi}}',
      label: 'EMI Result',
      type: 'select',
      required: true,
      scope: 'item',
      section: 'Body',
      options: ['PASS', 'REWORK', 'SCRAP', 'HOLD'],
    },
  ];
  if (!opts.dropBod) {
    fields.splice(7, 0, {
      token: '{{b_od}}',
      label: 'Box Min OD',
      type: 'text',
      required: true,
      scope: 'item',
      section: 'Box',
    });
  }
  return {
    displayName,
    region: { id: 'serials', marker: '{{sn}}' },
    disposition: { field: 'emi', requiredForApproval: true },
    fields,
  };
}

describe('Template definition-edit history [integration]', () => {
  let prisma: PrismaService;
  let service: TemplateDefinitionService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    service = new TemplateDefinitionService(
      prisma,
      new XlsNormalizerService(),
      new TokenExtractorService(),
    );
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  let tenantId: string;
  let templateId: string;

  beforeEach(async () => {
    await resetInspectionDomain(prisma);
    const tenant = await seedTenant(prisma);
    tenantId = tenant.id;
    const row = await prisma.template.create({
      data: {
        tenantId,
        templateKey: 'FIXTURE_REPORT',
        templateVersion: 1,
        status: 'ACTIVE',
        fileBlob: REAL_TEMPLATE_BYTES,
        hash: 'hash-fixture',
        changeNote: 'seed',
        createdById: 'seed-user',
        definitionJson: undefined, // NULL — no definition yet
      },
      select: { id: true },
    });
    templateId = row.id;
  });

  const currentDisplayName = async (): Promise<string | null> => {
    const t = await prisma.template.findUnique({
      where: { id: templateId },
      select: { definitionJson: true },
    });
    const def = t?.definitionJson as { displayName?: string } | null;
    return def?.displayName ?? null;
  };

  const revisions = () =>
    prisma.templateDefinitionRevision.findMany({
      where: { templateId },
      orderBy: { revisionNumber: 'asc' },
    });

  const define = (d: DefineTemplateDto) =>
    service.defineTemplate(tenantId, templateId, d, 'user-1');

  it('PROOF 5 — history is captured: the first define records NO revision; each later edit preserves the PRIOR', async () => {
    // First-ever define (prior NULL) → nothing to lose → no revision.
    await define(dto('A'));
    expect(await revisions()).toHaveLength(0);
    expect(await currentDisplayName()).toBe('A');

    // Second edit → revision 1 holds the PRIOR (A); current becomes B.
    await define(dto('B'));
    // Third edit → revision 2 holds the PRIOR (B); current becomes C.
    await define(dto('C'));

    const revs = await revisions();
    expect(revs.map((r) => r.revisionNumber)).toEqual([1, 2]);
    expect((revs[0]!.definitionJson as { displayName: string }).displayName).toBe('A');
    expect((revs[1]!.definitionJson as { displayName: string }).displayName).toBe('B');
    expect(await currentDisplayName()).toBe('C');

    // THE CLOBBER SCENARIO: define A then overwrite — A is now recoverable from revision 1.
    expect(
      (revs.find((r) => r.revisionNumber === 1)!.definitionJson as {
        displayName: string;
      }).displayName,
    ).toBe('A');
  });

  it('PROOF 6 — restore round-trips and is reversible (current-before-restore captured)', async () => {
    await define(dto('A')); // no revision (initial)
    await define(dto('B')); // revision 1 = A; current = B

    // Restore revision 1 (A). Runs the SAME validate gate; must not throw.
    await service.restoreDefinitionRevision(tenantId, templateId, 1, 'user-1');

    // Current is A again...
    expect(await currentDisplayName()).toBe('A');
    // ...and B was captured before the restore, so nothing is lost (restore is reversible).
    const revs = await revisions();
    expect(revs.map((r) => r.revisionNumber)).toEqual([1, 2]);
    expect((revs[0]!.definitionJson as { displayName: string }).displayName).toBe('A');
    expect((revs[1]!.definitionJson as { displayName: string }).displayName).toBe('B');
    expect(revs[1]!.revisionReason).toBe('restore of revision 1');
  });

  it('PROOF 7 — token-set classification: relabel = tokens-unchanged, add/drop = tokens-changed', async () => {
    await define(dto('A')); // initial, no revision

    // Cosmetic: same tokens, only a label differs → the revision capturing A is flagged
    // tokens-UNCHANGED.
    await define(dto('B')); // B has same token set as A (labels differ)
    // Structural: drop the {{b_od}} field → different token set → revision capturing B is
    // flagged tokens-CHANGED.
    await define(dto('C', { dropBod: true }));

    const revs = await revisions();
    const rev1 = revs.find((r) => r.revisionNumber === 1)!; // prior A, edit A→B
    const rev2 = revs.find((r) => r.revisionNumber === 2)!; // prior B, edit B→C
    expect(rev1.tokensChanged).toBe(false); // relabel only (A→B kept the token set)
    expect(rev2.tokensChanged).toBe(true); // B→C dropped {{b_od}}
    // Determinism: rev1 (prior A) and rev2 (prior B) hold the SAME token set (B relabels
    // A), so their signatures match — the classification lives in `tokensChanged`, not in
    // the captured prior's own hash.
    expect(rev1.tokenSetHash).toBe(rev2.tokenSetHash);
  });

  it('PROOF 9 — the list projection is metadata-only (never the full blob)', async () => {
    await define(dto('A'));
    await define(dto('B'));
    const list = await service.listDefinitionRevisions(tenantId, templateId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ revisionNumber: 1, tokensChanged: false });
    expect('definitionJson' in list[0]!).toBe(false); // blob NOT leaked in the list
  });
});
