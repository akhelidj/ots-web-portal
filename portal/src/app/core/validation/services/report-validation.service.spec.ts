import { ReportValidationService, ValidationResult } from './report-validation.service';
import { DRILL_PIPE_V1_SCHEMA } from '@portal/features/templates/schemas/drill-pipe-v1.schema';
import {
  LocalInspectionReport,
  LocalSerialNumber,
} from '@portal/core/offline/models/types';

/**
 * Consumer B (readiness/MISSING_FIELDS) definitionJson cutover. The required-field set is
 * now derived from the report's definitionJson through the SAME definitionToFormSchema
 * transform the form uses, with a soft-NULL fallback to DRILL_PIPE_V1_SCHEMA. These tests
 * prove: (a) the definition arm actually drives validation, (b) null falls back to legacy
 * unchanged, (c) a malformed definition never throws and falls back to legacy.
 */

const BASE_REPORT: LocalInspectionReport = {
  id: 'r1',
  customerId: 'c1',
  poNumber: 'PO-1',
  status: 'DRAFT' as LocalInspectionReport['status'],
  templateKey: 'DRILL_PIPE_REPORT',
  templateVersion: 1,
  templateHash: 'hash',
  version: 1,
};

/**
 * A minimal-but-valid template definition whose sole required item field — `Sentinel
 * Check` — does NOT exist anywhere in DRILL_PIPE_V1_SCHEMA. A MISSING_FIELDS message that
 * names it can therefore only originate from the definition arm, never the legacy walk.
 */
const SENTINEL_DEFINITION = {
  templateKey: 'DRILL_PIPE_REPORT',
  templateVersion: 1,
  sections: [{ key: 'box', title: 'Box Connection' }],
  fields: [
    {
      key: 'box.sentinelCheck',
      label: 'Sentinel Check',
      type: 'text',
      required: true,
      scope: 'item',
      section: 'box',
    },
  ],
};

function setNested(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/** inspectionJson with every legacy-required field present (emiResult a valid disposition). */
function fullyInspectedLegacy(): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const section of DRILL_PIPE_V1_SCHEMA.sections) {
    for (const field of section.fields) {
      if (field.required) {
        setNested(data, field.key, field.key === 'body.emiResult' ? 'PASS' : 'x');
      }
    }
  }
  return data;
}

function makeSerial(inspectionJson: Record<string, unknown>): LocalSerialNumber {
  return {
    id: 's1',
    inspectionReportId: 'r1',
    value: 'SN-001',
    version: 1,
    inspectionJson,
  };
}

describe('ReportValidationService — definitionJson cutover (Consumer B)', () => {
  let service: ReportValidationService;

  beforeEach(() => {
    service = new ReportValidationService();
  });

  it('(a) derives the required-field set from definitionJson when present', () => {
    const report = { ...BASE_REPORT, definitionJson: SENTINEL_DEFINITION };
    // emiResult present ⇒ no MISSING_DISPOSITION; the only candidate blocker is the
    // definition's required `box.sentinelCheck`, which the serial does not carry.
    const result = service.validate(report, [
      makeSerial({ body: { emiResult: 'PASS' } }),
    ]);

    const missing = result.issues.find((i) => i.code === 'MISSING_FIELDS');
    expect(missing).toBeDefined();
    // "Sentinel Check" exists only in the definition ⇒ the definition arm drove this.
    expect(missing!.message).toContain('Sentinel Check');
    // A legacy-only label must NOT appear ⇒ the legacy schema was not walked.
    expect(missing!.message).not.toContain('Min Tong Space');
    expect(result.isReady).toBe(false);
  });

  it('(b) falls back to DRILL_PIPE_V1_SCHEMA when definitionJson is null', () => {
    const report = { ...BASE_REPORT, definitionJson: null };

    // Fully inspected against the legacy schema ⇒ ready, no MISSING_FIELDS.
    const complete = service.validate(report, [
      makeSerial(fullyInspectedLegacy()),
    ]);
    expect(complete.issues.some((i) => i.code === 'MISSING_FIELDS')).toBe(false);
    expect(complete.isReady).toBe(true);

    // Drop one legacy-required field ⇒ legacy schema flags it by its legacy label.
    const data = fullyInspectedLegacy();
    delete (data['box'] as Record<string, unknown>)['minOD'];
    const missingOne = service.validate(report, [makeSerial(data)]);
    const missing = missingOne.issues.find((i) => i.code === 'MISSING_FIELDS');
    expect(missing).toBeDefined();
    expect(missing!.message).toContain('Min OD');
  });

  it('(c) does not throw on malformed definitionJson and falls back to legacy', () => {
    const garbageValues: unknown[] = [
      { nonsense: true }, // object without a fields[] array
      'not-a-definition', // primitive
      { fields: 'nope' }, // fields present but wrong type
      42,
    ];

    // Drop a legacy-required field so the legacy fallback has something to flag.
    const data = fullyInspectedLegacy();
    delete (data['box'] as Record<string, unknown>)['minOD'];

    for (const garbage of garbageValues) {
      const report = { ...BASE_REPORT, definitionJson: garbage };
      let result!: ValidationResult;
      expect(() => {
        result = service.validate(report, [makeSerial(data)]);
      }).not.toThrow();

      // Fell back to legacy ⇒ still flags the dropped legacy-required field.
      const missing = result.issues.find((i) => i.code === 'MISSING_FIELDS');
      expect(missing).toBeDefined();
      expect(missing!.message).toContain('Min OD');
    }
  });
});
