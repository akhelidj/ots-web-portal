/**
 * Slice A — rework trigger authoring, end-to-end and TEMPLATE-AGNOSTIC [integration].
 *
 * Proves the whole authored path works generically:
 *   author (buildDefinition → validateDefinition, the exact PUT pipeline) → persist the
 *   definitionJson on a Template → seed a report + serials → the LIVE
 *   ChildReportsService.syncReworkChildReport reads `definition.rules` and upserts the
 *   child over the matching serials.
 *
 * GENERALITY (the load-bearing claim): the SAME code drives two DIFFERENTLY-SHAPED
 * templates — different templateKey, different trigger field key, different childType and
 * suffix. No report type is named or special-cased anywhere; the trigger field is an
 * ordinary described item field resolved by its single-segment key (how the generic form
 * nests a described field into a serial's inspectionData).
 *
 * The write-time REJECTION of a malformed rule and its mutation guard live in the unit
 * gate spec (definition-validator.spec.ts, check 8 `rework-rules`); this spec proves the
 * happy path actually produces a child sync, twice, on unrelated shapes.
 */
import { InspectionReportStatus, ChildReportType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChildReportsService } from './child-reports.service';
import { ReworkRulesInterpreter } from './rework-rules.interpreter';
import { buildDefinition } from '../template/definition-builder';
import { validateDefinition } from '../template/definition-validator';
import { DefineTemplateDto } from '../template/definition-authoring.types';
import { resetInspectionDomain, seedTenant } from '../../../test/seed-helpers';

/**
 * The six mandatory header-role fields + the item `serialNumber` field, shared by the
 * authored DTOs so every definition clears the all-seven-roles gate (validator check 4c).
 * The header roles bind to computed tokens; the `serialNumber` role marks the region's
 * `{{sn}}` marker. None of these participate in the rework trigger — that stays on the
 * ordinary item field each template authors.
 */
const MANDATORY_ROLE_FIELDS: DefineTemplateDto['fields'] = [
  { token: '{{customer}}', label: 'Customer', type: 'text', required: false, scope: 'header', role: 'customer' },
  { token: '{{reportNumber}}', label: 'Report Number', type: 'text', required: false, scope: 'header', role: 'reportNumber' },
  { token: '{{poNumber}}', label: 'PO Number', type: 'text', required: false, scope: 'header', role: 'poNumber' },
  { token: '{{inspBy}}', label: 'Inspector', type: 'text', required: false, scope: 'header', role: 'inspector' },
  { token: '{{apprBy}}', label: 'Supervisor', type: 'text', required: false, scope: 'header', role: 'supervisor' },
  { token: '{{inspDate}}', label: 'Inspection Date', type: 'date', required: false, scope: 'header', role: 'inspectionDate' },
  { token: '{{sn}}', label: 'Serial Number', type: 'text', required: false, scope: 'item', role: 'serialNumber' },
];

/** The tokens the mandatory role fields reference — merged into each template's token set. */
const MANDATORY_ROLE_TOKENS = [
  '{{customer}}',
  '{{reportNumber}}',
  '{{poNumber}}',
  '{{inspBy}}',
  '{{apprBy}}',
  '{{inspDate}}',
  '{{sn}}',
];

describe('rework authoring — end-to-end, template-agnostic [integration]', () => {
  let prisma: PrismaService;
  let service: ChildReportsService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    service = new ChildReportsService(
      prisma,
      new ReworkRulesInterpreter(prisma),
    );
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  beforeEach(() => resetInspectionDomain(prisma));

  /**
   * Author a definition exactly as `PUT /templates/:id/definition` does — build the
   * candidate, run it through the REAL write-time gate, assert it is accepted — then
   * persist it onto an ACTIVE Template. Returns nothing; the assertion IS the write-through
   * + validation proof.
   */
  async function authorAndPersist(
    tenantId: string,
    templateKey: string,
    dto: DefineTemplateDto,
    tokens: ReadonlySet<string>,
  ): Promise<void> {
    const candidate = buildDefinition({ templateKey, templateVersion: 1 }, dto);
    // The authored rule survives the gate (check 8 accepts a well-formed rule).
    expect(validateDefinition(candidate, tokens)).toEqual({ ok: true });
    await prisma.template.create({
      data: {
        tenantId,
        templateKey,
        templateVersion: 1,
        status: 'ACTIVE',
        fileKey: `${tenantId}/${templateKey}/1`,
        hash: `hash-${templateKey}`,
        changeNote: 'authored',
        createdById: 'seed-user',
        definitionJson: candidate as never,
      },
    });
  }

  function seedReport(tenantId: string, templateKey: string, reportNumber: string) {
    return prisma.inspectionReport.create({
      data: {
        tenantId,
        poNumber: 'PO-E2E',
        reportNumber,
        templateKey,
        templateVersion: 1,
        templateHash: `hash-${templateKey}`,
        status: InspectionReportStatus.DRAFT,
      },
    });
  }

  function seedSerial(
    tenantId: string,
    reportId: string,
    serial: string,
    inspectionData: Record<string, unknown>,
  ) {
    return prisma.serialNumber.create({
      data: {
        tenantId,
        inspectionReportId: reportId,
        serial,
        inspectionData: inspectionData as never,
      },
    });
  }

  /** Read back the child of a given type with its linked serial strings (sorted). */
  async function childWithMembers(reportId: string, type: ChildReportType) {
    const child = await prisma.childReport.findFirst({
      where: { inspectionReportId: reportId, type },
      include: { serialNumbers: { include: { serialNumber: true } } },
    });
    if (!child) return null;
    return {
      type: child.type,
      status: child.status,
      version: child.version,
      reportNumber: child.reportNumber,
      members: child.serialNumbers
        .map((m) => m.serialNumber?.serial ?? '')
        .sort(),
    };
  }

  it('TEMPLATE A (had no rule): author a REWORK trigger → it drives a child sync', async () => {
    const tenant = await seedTenant(prisma);
    const key = 'CASING_REPORT';
    // A region template with one item field `emi`; the authored rule triggers on it.
    const dto: DefineTemplateDto = {
      displayName: 'Casing Inspection',
      region: { id: 'serials', marker: '{{sn}}' },
      fields: [
        ...MANDATORY_ROLE_FIELDS,
        {
          token: '{{emi}}',
          label: 'EMI Result',
          type: 'select',
          required: true,
          scope: 'item',
          section: 'Body',
          options: ['PASS', 'REWORK'],
        },
      ],
      reworkRule: {
        field: 'emi', // the described item field's single-segment key
        equals: 'REWORK',
        childType: 'REWORK',
        reportNumberSuffix: '_rw',
      },
    };
    await authorAndPersist(
      tenant.id,
      key,
      dto,
      new Set(['{{sn}}', '{{emi}}', ...MANDATORY_ROLE_TOKENS]),
    );

    const report = await seedReport(tenant.id, key, 'RPT-A');
    await seedSerial(tenant.id, report.id, 'SN-1', { emi: 'REWORK' }); // matches
    await seedSerial(tenant.id, report.id, 'SN-2', { emi: 'PASS' }); // control

    await service.syncReworkChildReport(tenant.id, report.id);

    expect(await childWithMembers(report.id, ChildReportType.REWORK)).toEqual({
      type: ChildReportType.REWORK,
      status: 'DRAFT',
      version: 1,
      reportNumber: 'RPT-A_rw',
      members: ['SN-1'], // only the matching serial
    });
  });

  it('TEMPLATE B (different shape): different field + childType → same generic path', async () => {
    const tenant = await seedTenant(prisma);
    const key = 'TUBING_REPORT';
    // Different key, different trigger field key (`status`), different childType (SCRAP)
    // and suffix — nothing overlaps with Template A. The identical code path handles it.
    const dto: DefineTemplateDto = {
      displayName: 'Tubing Inspection',
      region: { id: 'rows', marker: '{{sn}}' },
      fields: [
        ...MANDATORY_ROLE_FIELDS,
        {
          token: '{{status}}',
          label: 'Condition',
          type: 'select',
          required: true,
          scope: 'item',
          section: 'Assessment',
          options: ['GOOD', 'BAD'],
        },
      ],
      reworkRule: {
        field: 'status',
        equals: 'BAD',
        childType: 'SCRAP',
        reportNumberSuffix: '-scrap',
      },
    };
    await authorAndPersist(
      tenant.id,
      key,
      dto,
      new Set(['{{sn}}', '{{status}}', ...MANDATORY_ROLE_TOKENS]),
    );

    const report = await seedReport(tenant.id, key, 'RPT-B');
    await seedSerial(tenant.id, report.id, 'T-1', { status: 'BAD' }); // matches
    await seedSerial(tenant.id, report.id, 'T-2', { status: 'GOOD' }); // control

    await service.syncReworkChildReport(tenant.id, report.id);

    // A SCRAP child (not REWORK) links only the BAD serial — the rule's childType is honoured.
    expect(await childWithMembers(report.id, ChildReportType.SCRAP)).toEqual({
      type: ChildReportType.SCRAP,
      status: 'DRAFT',
      version: 1,
      reportNumber: 'RPT-B-scrap',
      members: ['T-1'],
    });
    // And no REWORK child was fabricated — the authored childType is the only one produced.
    expect(await childWithMembers(report.id, ChildReportType.REWORK)).toBeNull();
  });
});
