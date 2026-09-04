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
  '{{reportNumber}}',
  '{{customer}}',
  '{{inspBy}}',
  '{{apprBy}}',
  '{{inspDate}}',
  '{{grade}}',
  '{{emi}}',
]);
const META = { templateKey: 'PUMP_REPORT', templateVersion: 1 };

/**
 * The canonical VALID ops description — now fully roled. Every one of the seven system roles
 * is mapped: the six header roles (customer/reportNumber/poNumber/inspector/supervisor/
 * inspectionDate) each on their own header field, and the item role `serialNumber` on the
 * serial's own token. Roles are MANDATORY to save (validator check 4c), so a valid fixture
 * must assign them all — a definition missing any is rejected (proven below). No explicit
 * `computed` entry: the `customer` role already binds `{{customer}}` to the `customerName`
 * computed via ROLE_TO_COMPUTED.
 */
function validDto(): DefineTemplateDto {
  return {
    displayName: 'Pump Inspection',
    region: { id: 'serials', marker: '{{sn}}' },
    disposition: { field: 'emi', requiredForApproval: true },
    fields: [
      { token: '{{customer}}', label: 'Customer', type: 'text', required: false, scope: 'header', role: 'customer' },
      { token: '{{reportNumber}}', label: 'Report Number', type: 'text', required: false, scope: 'header', role: 'reportNumber' },
      { token: '{{poNumber}}', label: 'PO Number', type: 'text', required: false, scope: 'header', role: 'poNumber' },
      { token: '{{inspBy}}', label: 'Inspector', type: 'text', required: false, scope: 'header', role: 'inspector' },
      { token: '{{apprBy}}', label: 'Supervisor', type: 'text', required: false, scope: 'header', role: 'supervisor' },
      { token: '{{inspDate}}', label: 'Inspection Date', type: 'date', required: false, scope: 'header', role: 'inspectionDate' },
      { token: '{{sn}}', label: 'Serial Number', type: 'text', required: false, scope: 'item', role: 'serialNumber' },
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
  };
}

/** validDto stripped of ALL roles — a pre-mandate ("grandfathered") shape. Valid before the
 *  mandate, now rejected at save by check 4c. Used to prove the mandatory gate. */
function noRolesDto(): DefineTemplateDto {
  const dto = validDto();
  dto.fields = dto.fields.map((f) => {
    const { role: _role, ...rest } = f;
    return rest;
  });
  // Without the serialNumber role the region marker still names {{sn}}; the builder emits it
  // as rowSerial regardless, so the shape stays engine-valid — only the role mandate fails.
  return dto;
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
 * names); the validator enforces header-scope, a known role, role uniqueness, and — now —
 * that every one of the seven system roles is present (check 4c). `validDto` is fully roled,
 * so these exercise the mapping/scope/uniqueness rules against clones of it.
 */
describe('validateDefinition — field roles [unit]', () => {
  describe('builder — a roled field binds to the existing computed token', () => {
    it('emits the roled token as a computed export entry, not a user `field`', () => {
      const built = buildDefinition(META, validDto());
      const entry = built.export.global.find((e) => e.token === '{{inspBy}}');
      expect(entry).toEqual({ token: '{{inspBy}}', computed: 'inspectedBy' });
    });

    it('keeps the role on the built field (for read-only rendering)', () => {
      const built = buildDefinition(META, validDto());
      expect(built.fields.find((f) => f.key === 'inspBy')?.role).toBe('inspector');
    });

    it('supervisor→approvedBy, inspectionDate→reportDate, customer→customerName, reportNumber/poNumber map likewise', () => {
      const g = buildDefinition(META, validDto()).export.global;
      expect(g.find((e) => e.token === '{{apprBy}}')).toEqual({ token: '{{apprBy}}', computed: 'approvedBy' });
      expect(g.find((e) => e.token === '{{inspDate}}')).toEqual({ token: '{{inspDate}}', computed: 'reportDate' });
      expect(g.find((e) => e.token === '{{customer}}')).toEqual({ token: '{{customer}}', computed: 'customerName' });
      expect(g.find((e) => e.token === '{{reportNumber}}')).toEqual({ token: '{{reportNumber}}', computed: 'reportNumber' });
      expect(g.find((e) => e.token === '{{poNumber}}')).toEqual({ token: '{{poNumber}}', computed: 'poNumber' });
    });
  });

  describe('validator', () => {
    it('accepts a definition mapping all seven system roles', () => {
      expect(validateDefinition(buildDefinition(META, validDto()), TOKENS)).toEqual({ ok: true });
    });

    it('a template with NO roles is REJECTED — every system role is mandatory to save', () => {
      const outcome = validateDefinition(buildDefinition(META, noRolesDto()), TOKENS);
      expect(outcome).toMatchObject({ ok: false, check: 'roles-mandatory' });
      // The message names the unassigned roles so ops knows exactly what to add.
      const reason = (outcome as { reason: string }).reason;
      for (const role of [
        'inspector',
        'supervisor',
        'inspectionDate',
        'customer',
        'reportNumber',
        'poNumber',
        'serialNumber',
      ]) {
        expect(reason).toContain(role);
      }
    });

    it('rejects when a single header role is left unassigned (names it)', () => {
      const dto = validDto();
      // Drop just the poNumber role → the field becomes a plain header field.
      const target = dto.fields.find((f) => f.role === 'poNumber')!;
      delete target.role;
      const outcome = validateDefinition(buildDefinition(META, dto), TOKENS);
      expect(outcome).toMatchObject({ ok: false, check: 'roles-mandatory' });
      expect((outcome as { reason: string }).reason).toContain('poNumber');
    });

    it('rejects a role on an item-scope field', () => {
      const c = clone(buildDefinition(META, validDto()));
      // `grade` is the plain (role-less) item field; giving it a header role trips 4b
      // (role-header-scope) before the mandatory check 4c is ever reached.
      c.fields.find((f) => f.key === 'grade')!.role = 'inspector';
      expect(validateDefinition(c, TOKENS)).toMatchObject({
        ok: false,
        check: 'role-header-scope',
      });
    });

    it('rejects the same role used by two fields', () => {
      const c = clone(buildDefinition(META, validDto()));
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
      const c = clone(buildDefinition(META, validDto()));
      (c.fields.find((f) => f.role === 'customer') as { role: string }).role = 'bogus';
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
 * the per-serial export entries so it can't shadow rowSerial. `validDto` already carries it
 * on `{{sn}}`, so these exercise its wiring against clones of validDto.
 */
describe('validateDefinition — item role (serialNumber) [unit]', () => {
  it('accepts serialNumber on an item field (part of the fully-roled valid definition)', () => {
    expect(
      validateDefinition(buildDefinition(META, validDto()), TOKENS),
    ).toEqual({ ok: true });
  });

  it('keeps the serialNumber field in candidate.fields but emits its token only as rowSerial', () => {
    const built = buildDefinition(META, validDto());
    // Kept in fields (with its role) so the validator sees it…
    expect(built.fields.find((f) => f.key === 'sn')?.role).toBe('serialNumber');
    // …but the ONLY export entry for its token is the region's rowSerial (no shadowing
    // plain-field entry that would blank the serial number).
    expect(
      built.export.regions['serials']!.filter((e) => e.token === '{{sn}}'),
    ).toEqual([{ token: '{{sn}}', source: 'rowSerial' }]);
  });

  it('rejects serialNumber on a header-scope field (item-scope only)', () => {
    const c = clone(buildDefinition(META, validDto()));
    c.fields.find((f) => f.key === 'sn')!.scope = 'header';
    expect(validateDefinition(c, TOKENS)).toMatchObject({
      ok: false,
      check: 'role-item-scope',
    });
  });

  it('rejects two fields carrying serialNumber (role-unique)', () => {
    const c = clone(buildDefinition(META, validDto()));
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
