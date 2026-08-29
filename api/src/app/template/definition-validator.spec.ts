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
  '{{inspBy}}',
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

/**
 * Slice A — the rework trigger is ops-authorable, and check 8 (rework-rules) is the
 * write-time gate that keeps a malformed rule off a live report. Generic over templates:
 * the trigger field is an ordinary described item field, never a named special-case.
 */
describe('validateDefinition — rework rule (slice A) [unit]', () => {
  /** validDto + an authored rework rule keyed on the ordinary `emi` item field. */
  function reworkDto(): DefineTemplateDto {
    return {
      ...validDto(),
      reworkRule: {
        field: 'emi',
        equals: 'REWORK',
        childType: 'REWORK',
        reportNumberSuffix: '_rw',
      },
    };
  }

  describe('write-through — the builder emits exactly the interpreter shape', () => {
    it('no reworkRule → rules: [] (unchanged historical behaviour)', () => {
      expect(buildDefinition(META, validDto()).rules).toEqual([]);
    });

    it('authored rule → one rule in the exact parseUpsertRule shape (no unread fields)', () => {
      const rules = buildDefinition(META, reworkDto()).rules;
      expect(rules).toEqual([
        {
          when: { field: 'emi', op: 'eq', value: 'REWORK' },
          then: {
            action: 'upsertChildReport',
            childType: 'REWORK',
            membership: 'allItemsMatching',
            reportNumberSuffix: '_rw',
          },
        },
      ]);
      // The interpreter-ignored knobs are NEVER emitted (no authored-but-unread trap).
      const then = (rules[0] as { then: Record<string, unknown> }).then;
      expect('forbidChildDisposition' in then).toBe(false);
      expect('id' in (rules[0] as object)).toBe(false);
      expect('scope' in (rules[0] as object)).toBe(false);
    });

    it('omitted suffix → the suffix key is absent (interpreter defaults it to "")', () => {
      const dto = reworkDto();
      delete dto.reworkRule!.reportNumberSuffix;
      const then = (buildDefinition(META, dto).rules[0] as { then: object }).then;
      expect('reportNumberSuffix' in then).toBe(false);
    });
  });

  describe('the gate accepts a valid rule and rejects a malformed one at WRITE time', () => {
    it('accepts a well-formed authored rule', () => {
      expect(validateDefinition(buildDefinition(META, reworkDto()), TOKENS)).toEqual({
        ok: true,
      });
    });

    it('rejects an empty trigger field (author enabled but picked nothing)', () => {
      const dto = reworkDto();
      dto.reworkRule!.field = '';
      expect(validateDefinition(buildDefinition(META, dto), TOKENS)).toMatchObject({
        ok: false,
        check: 'rework-rules',
      });
    });

    it('rejects an unknown childType', () => {
      const dto = reworkDto();
      dto.reworkRule!.childType = 'NOT_A_TYPE';
      expect(validateDefinition(buildDefinition(META, dto), TOKENS)).toMatchObject({
        ok: false,
        check: 'rework-rules',
      });
    });

    it('rejects 2+ rules (multi-rule unsupported by the interpreter)', () => {
      const c = clone(buildDefinition(META, reworkDto()));
      c.rules.push(c.rules[0]);
      expect(validateDefinition(c, TOKENS)).toMatchObject({
        ok: false,
        check: 'rework-rules',
      });
    });

    it('rejects an unknown action', () => {
      const c = clone(buildDefinition(META, reworkDto()));
      (c.rules[0] as { then: { action: string } }).then.action = 'deleteEverything';
      expect(validateDefinition(c, TOKENS)).toMatchObject({
        ok: false,
        check: 'rework-rules',
      });
    });
  });

  describe('mutation guard — check 8 is the SOLE gate catching a bad rule (rework)', () => {
    it('a malformed rule clears checks 1–7 and is caught ONLY by rework-rules', () => {
      // An unknown childType is invisible to every export/gate reader (checks 1–7 pass on
      // an otherwise-valid candidate); dropping the rules to [] would make the SAME
      // candidate pass. So the rejection can only come from check 8 — proving the
      // interpreter dry-run is load-bearing, not decorative.
      const c = clone(buildDefinition(META, reworkDto()));
      (c.rules[0] as { then: { childType: string } }).then.childType = 'NOT_A_TYPE';

      expect(validateDefinition(c, TOKENS)).toMatchObject({
        ok: false,
        check: 'rework-rules',
      });

      // Same candidate, rule content removed → accepted. Isolates the rule as the cause.
      const cleared = clone(c);
      cleared.rules = [];
      expect(validateDefinition(cleared, TOKENS)).toEqual({ ok: true });
    });
  });
});

/**
 * Field ROLES — a header field bound to a system-derived value via the engine's existing
 * computed tokens. The builder maps the role onto the computed name (no new computed
 * names); the validator enforces header-scope, a known role, and role uniqueness.
 */
describe('validateDefinition — field roles [unit]', () => {
  /** validDto + one header field carrying the `inspector` role. */
  function roledDto(): DefineTemplateDto {
    const dto = validDto();
    dto.fields.push({
      token: '{{inspBy}}',
      label: 'Inspector',
      type: 'text',
      required: false,
      scope: 'header',
      role: 'inspector',
    });
    return dto;
  }

  describe('builder — a roled field binds to the existing computed token', () => {
    it('emits the roled token as a computed export entry, not a user `field`', () => {
      const built = buildDefinition(META, roledDto());
      const entry = built.export.global.find((e) => e.token === '{{inspBy}}');
      expect(entry).toEqual({ token: '{{inspBy}}', computed: 'inspectedBy' });
    });

    it('keeps the role on the built field (for read-only rendering)', () => {
      const built = buildDefinition(META, roledDto());
      expect(built.fields.find((f) => f.key === 'inspBy')?.role).toBe('inspector');
    });

    it('supervisor→approvedBy and inspectionDate→reportDate map likewise', () => {
      const dto = validDto();
      dto.fields.push(
        { token: '{{apprBy}}', label: 'Supervisor', type: 'text', required: false, scope: 'header', role: 'supervisor' },
        { token: '{{when}}', label: 'Date', type: 'date', required: false, scope: 'header', role: 'inspectionDate' },
      );
      const g = buildDefinition(META, dto).export.global;
      expect(g.find((e) => e.token === '{{apprBy}}')).toEqual({ token: '{{apprBy}}', computed: 'approvedBy' });
      expect(g.find((e) => e.token === '{{when}}')).toEqual({ token: '{{when}}', computed: 'reportDate' });
    });
  });

  describe('validator', () => {
    it('accepts a definition with a valid header role', () => {
      expect(validateDefinition(buildDefinition(META, roledDto()), TOKENS)).toEqual({ ok: true });
    });

    it('a template with NO roles is valid (roles are optional)', () => {
      expect(validateDefinition(buildDefinition(META, validDto()), TOKENS)).toEqual({ ok: true });
    });

    it('rejects a role on an item-scope field', () => {
      const c = clone(buildDefinition(META, validDto()));
      c.fields.find((f) => f.scope === 'item')!.role = 'inspector';
      expect(validateDefinition(c, TOKENS)).toMatchObject({
        ok: false,
        check: 'role-header-scope',
      });
    });

    it('rejects the same role used by two fields', () => {
      const c = clone(buildDefinition(META, roledDto()));
      c.fields.push({
        key: 'inspBy2',
        label: 'Inspector 2',
        type: 'text',
        required: false,
        scope: 'header',
        role: 'inspector',
      });
      expect(validateDefinition(c, TOKENS)).toMatchObject({
        ok: false,
        check: 'role-unique',
      });
    });

    it('rejects an unknown role', () => {
      const c = clone(buildDefinition(META, roledDto()));
      (c.fields.find((f) => f.role) as { role: string }).role = 'bogus';
      expect(validateDefinition(c, TOKENS)).toMatchObject({
        ok: false,
        check: 'role-known',
      });
    });
  });
});

/**
 * The ITEM role `serialNumber` — marks the serial's own token (the region marker /
 * rowSerial). Item-scope only, unique, kept in `fields` for validation but excluded from
 * the per-serial export entries so it can't shadow rowSerial.
 */
describe('validateDefinition — item role (serialNumber) [unit]', () => {
  /** validDto + the `{{sn}}` token described as an item field carrying `serialNumber`. */
  function serialRoleDto(): DefineTemplateDto {
    const dto = validDto();
    dto.fields.push({
      token: '{{sn}}',
      label: 'Serial Number',
      type: 'text',
      required: false,
      scope: 'item',
      role: 'serialNumber',
    });
    return dto;
  }

  it('accepts serialNumber on an item field', () => {
    expect(
      validateDefinition(buildDefinition(META, serialRoleDto()), TOKENS),
    ).toEqual({ ok: true });
  });

  it('keeps the serialNumber field in candidate.fields but emits its token only as rowSerial', () => {
    const built = buildDefinition(META, serialRoleDto());
    // Kept in fields (with its role) so the validator sees it…
    expect(built.fields.find((f) => f.key === 'sn')?.role).toBe('serialNumber');
    // …but the ONLY export entry for its token is the region's rowSerial (no shadowing
    // plain-field entry that would blank the serial number).
    expect(
      built.export.regions['serials']!.filter((e) => e.token === '{{sn}}'),
    ).toEqual([{ token: '{{sn}}', source: 'rowSerial' }]);
  });

  it('rejects serialNumber on a header-scope field (item-scope only)', () => {
    const c = clone(buildDefinition(META, serialRoleDto()));
    c.fields.find((f) => f.key === 'sn')!.scope = 'header';
    expect(validateDefinition(c, TOKENS)).toMatchObject({
      ok: false,
      check: 'role-item-scope',
    });
  });

  it('rejects two fields carrying serialNumber (role-unique)', () => {
    const c = clone(buildDefinition(META, serialRoleDto()));
    c.fields.push({
      key: 'sn2',
      label: 'Serial 2',
      type: 'text',
      required: false,
      scope: 'item',
      role: 'serialNumber',
    });
    expect(validateDefinition(c, TOKENS)).toMatchObject({
      ok: false,
      check: 'role-unique',
    });
  });
});
