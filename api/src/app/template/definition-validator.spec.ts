/**
 * Phase D step 2a — write-time validation gate (unit; no DB).
 *
 * Proves each of the seven checks refuses a bad candidate, that a valid ops-built
 * definition round-trips the REAL engine readers without throwing (engine-valid),
 * and a non-vacuous mutation guard for the engine-dry-run check specifically.
 *
 * Two checks — `single-region` and `engine-dry-run` — are not reachable from the
 * ops DTO (buildDefinition always emits exactly one region and no transforms), so
 * they are defense-in-depth proven here on hand-crafted candidates. The other five
 * are also proven end-to-end (with atomicity) in the integration spec.
 */
import { buildDefinition } from './definition-builder';
import { validateDefinition } from './definition-validator';
import {
  DefineTemplateDto,
  CandidateDefinition,
} from './definition-authoring.types';
import {
  engineGlobalTokens,
  engineRowTokens,
  engineRowTokenKeys,
  ExportDefinition,
} from '../export/export-engine';

const TOKENS: ReadonlySet<string> = new Set([
  '{{sn}}',
  '{{poNumber}}',
  '{{grade}}',
  '{{emi}}',
  '{{customer}}',
]);
const META = { templateKey: 'PUMP_REPORT', templateVersion: 1 };

function validDto(): DefineTemplateDto {
  return {
    displayName: 'Pump Inspection',
    region: { id: 'serials', marker: '{{sn}}' },
    disposition: { field: 'emi', requiredForApproval: true },
    fields: [
      {
        token: '{{poNumber}}',
        label: 'PO Number',
        type: 'text',
        required: false,
        scope: 'header',
      },
      {
        token: '{{grade}}',
        label: 'Grade',
        type: 'text',
        required: true,
        scope: 'item',
        section: 'Body',
      },
      {
        token: '{{emi}}',
        label: 'EMI Result',
        type: 'select',
        required: true,
        scope: 'item',
        section: 'Body',
        options: ['PASS', 'FAIL'],
      },
    ],
    computed: [{ token: '{{customer}}', computed: 'customerName' }],
  };
}

const clone = (d: CandidateDefinition): CandidateDefinition =>
  JSON.parse(JSON.stringify(d)) as CandidateDefinition;

describe('validateDefinition — write-time gate [unit]', () => {
  describe('happy path (engine-valid)', () => {
    it('accepts a valid ops-built definition', () => {
      const candidate = buildDefinition(META, validDto());
      expect(validateDefinition(candidate, TOKENS)).toEqual({ ok: true });
    });

    it('the accepted definition round-trips the REAL engine readers without throwing', () => {
      const candidate = buildDefinition(META, validDto());
      const def = candidate as unknown as ExportDefinition;
      expect(() => {
        engineGlobalTokens(def, {
          header: {},
          serialNumbers: [],
          transitionLogs: [],
          users: [],
        } as never);
        engineRowTokenKeys(def);
        engineRowTokens(
          def,
          { header: {}, transitionLogs: [], users: [] } as never,
          { serial: 'S1', inspectionData: {} } as never,
        );
      }).not.toThrow();
    });
  });

  describe('rejections — one per check (whole definition refused)', () => {
    it('2 — bad type', () => {
      const c = clone(buildDefinition(META, validDto()));
      (c.fields[1] as { type: string }).type = 'list';
      expect(validateDefinition(c, TOKENS)).toMatchObject({
        ok: false,
        check: 'types-renderable',
      });
    });

    it('3 — non-boolean required', () => {
      const c = clone(buildDefinition(META, validDto()));
      (c.fields[0] as { required: unknown }).required = 'yes';
      expect(validateDefinition(c, TOKENS)).toMatchObject({
        ok: false,
        check: 'required-boolean',
      });
    });

    it('4 — select without options', () => {
      const c = clone(buildDefinition(META, validDto()));
      const sel = c.fields.find((f) => f.type === 'select')!;
      delete (sel as { options?: string[] }).options;
      expect(validateDefinition(c, TOKENS)).toMatchObject({
        ok: false,
        check: 'select-options',
      });
    });

    it('5 — unknown computed name', () => {
      const c = clone(buildDefinition(META, validDto()));
      const comp = c.export.global.find((e) => e.computed)!;
      comp.computed = 'notARealComputed';
      expect(validateDefinition(c, TOKENS)).toMatchObject({
        ok: false,
        check: 'computed-allowlist',
      });
    });

    it('6 — two or more regions', () => {
      const c = clone(buildDefinition(META, validDto()));
      c.regions.push({
        id: 'second',
        label: 'second',
        marker: '{{sn}}',
        chunkSize: null,
      });
      expect(validateDefinition(c, TOKENS)).toMatchObject({
        ok: false,
        check: 'single-region',
      });
    });

    it('1 — a declared token not present in the sheet', () => {
      const c = clone(buildDefinition(META, validDto()));
      c.export.global.push({ token: '{{ghost}}', field: 'ghost' });
      expect(validateDefinition(c, TOKENS)).toMatchObject({
        ok: false,
        check: 'tokens-exist',
      });
    });

    it('7 — passes the shallow checks but the engine dry-run throws (unknown transform)', () => {
      const c = clone(buildDefinition(META, validDto()));
      // Reference a transform that does not exist in `transforms: {}` — this is
      // shallow-valid (types/required/select/computed/tokens/one-region all fine)
      // but applyTransform throws inside engineRowTokens.
      c.export.regions['serials']!.push({
        token: '{{grade}}',
        field: 'grade',
        transform: 'noSuchTransform',
      });
      expect(validateDefinition(c, TOKENS)).toMatchObject({
        ok: false,
        check: 'engine-dry-run',
      });
    });
  });

  describe('mutation guard — engine-dry-run is non-vacuous', () => {
    it('corrupting the candidate makes the engine throw (rejected); removing it accepts', () => {
      const base = buildDefinition(META, validDto());

      // Corrupt: reference an undefined transform → engine throws → dry-run rejects.
      const corrupted = clone(base);
      corrupted.export.regions['serials']!.push({
        token: '{{grade}}',
        field: 'grade',
        transform: 'noSuchTransform',
      });
      const rejected = validateDefinition(corrupted, TOKENS);
      expect(rejected).toMatchObject({ ok: false, check: 'engine-dry-run' });

      // Remove the corruption → the same candidate is accepted.
      expect(validateDefinition(base, TOKENS)).toEqual({ ok: true });
    });
  });
});
