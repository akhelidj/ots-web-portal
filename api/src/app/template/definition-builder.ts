import { BadRequestException } from '@nestjs/common';
import {
  DefineTemplateDto,
  CandidateDefinition,
  CandidateExportEntry,
  HeaderFieldRole,
  ROLE_TO_COMPUTED,
} from './definition-authoring.types';
import { OUTCOME_BUCKETS, OutcomeMapping } from '../workflow/approval-gate';

/**
 * Normalize an authored outcome mapping into the stored shape: keep only the known
 * buckets, drop any whose `values` is absent/empty (an empty bucket is "unmapped"), trim
 * blank values, and carry a per-bucket `token` only when the author set one. Returns
 * `undefined` when nothing maps, so the builder omits `outcomes` entirely (→ everything
 * classifies as `'other'`). PURE and total — semantic checks are the validator's job.
 */
function normalizeOutcomes(
  outcomes: OutcomeMapping | undefined,
): OutcomeMapping | undefined {
  if (!outcomes || typeof outcomes !== 'object') return undefined;
  const out: OutcomeMapping = {};
  for (const bucket of OUTCOME_BUCKETS) {
    const rule = outcomes[bucket];
    if (!rule || !Array.isArray(rule.values)) continue;
    const values = rule.values
      .map((v) => String(v).trim())
      .filter((v) => v.length > 0);
    if (values.length === 0) continue;
    const token =
      typeof rule.token === 'string' && rule.token.trim().length > 0
        ? rule.token.trim()
        : undefined;
    out[bucket] = token ? { token, values } : { values };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The repeating region's internal id. It only keys `export.regions[REGION_ID]` and the
 * region entry — it is not an ops choice and carries no external meaning, so it is a
 * constant rather than an authored value (`dto.region.id` is accepted but ignored).
 * Stored/hand-authored definitions may use a different id (e.g. drill-pipe's `serials`);
 * the engine keys off whatever `regions[0].id` each definition carries, so both resolve.
 */
const REGION_ID = 'serials';

/**
 * Phase D step 2a — ops description → engine-shaped candidate definition.
 *
 * PURE and TOTAL for well-formed input: given a syntactically-valid DTO it always
 * produces a candidate in the exact shape `export-engine.ts` / `approval-gate.ts`
 * read. It throws `BadRequestException` only for structurally-broken input (a region
 * missing its serial token, non-array fields, duplicate tokens) — the SEMANTIC checks
 * (types, computed allow-list, tokens-in-sheet, engine dry-run) live in the validator.
 *
 * Field KEY derivation: the data key is the token stripped of its braces, e.g.
 * `"{{poNumber}}"` → `"poNumber"`, `"{{b_ts}}"` → `"b_ts"`. This makes the
 * export-entry field binding trivially consistent (entry.field === derived key)
 * and frees ops from inventing dotted keys.
 *
 * EQUIVALENCE BOUNDARY vs. the hand-authored drill-pipe definition — the ops flow
 * covers: field descriptions (label/type/required/scope/section/options), the
 * header→global / item→region token bindings, the single region + its serial
 * token, an optional disposition source, computed token bindings (5-key set), and
 * (slice A) an optional single `reworkRule` — the one `upsertChildReport` trigger shape
 * the interpreter consumes. It does NOT author: value transforms (drill-pipe's
 * boolFlag/boolCheckbox/range/list joins), extra rework operators/multi-rule, or
 * multi-path coalesce/compose export entries. A definition it produces is engine-VALID;
 * it reproduces drill-pipe only on the transform-free, single-path fields.
 */
export function buildDefinition(
  meta: { templateKey: string; templateVersion: number },
  dto: DefineTemplateDto,
): CandidateDefinition {
  if (!dto || typeof dto !== 'object') {
    throw new BadRequestException('A definition body is required.');
  }
  // A region is OPTIONAL (flat templates omit it). But if one IS supplied it must name
  // the serial's own token (the `rowSerial` placeholder), else it is a structural error.
  // (The region id is an internal constant now — not required from the author.)
  if (dto.region && typeof dto.region.marker !== 'string') {
    throw new BadRequestException(
      'A repeating region needs a serial token (`marker`).',
    );
  }
  if (!Array.isArray(dto.fields)) {
    throw new BadRequestException('`fields` must be an array.');
  }

  const strip = (t: string): string =>
    String(t).replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '');

  // Reject duplicate token descriptions up front — an ambiguous mapping is a
  // structural error, not a semantic one.
  const seen = new Set<string>();
  for (const f of dto.fields) {
    if (!f || typeof f.token !== 'string') {
      throw new BadRequestException('Every field must carry a `token` string.');
    }
    if (seen.has(f.token)) {
      throw new BadRequestException(`Duplicate token in fields: ${f.token}`);
    }
    seen.add(f.token);
  }

  const headerFields = dto.fields.filter((f) => f.scope === 'header');
  // Item fields for the FORM/EXPORT — excludes the `serialNumber`-roled field. That field
  // marks the serial's own token (emitted ONCE as the region's `rowSerial` from
  // `region.marker`); emitting it again here as a plain per-serial export entry would
  // shadow `rowSerial` and blank the serial number. It is kept in `fields` below (with its
  // role) so the validator can enforce item-scope + uniqueness, but never rendered or
  // exported as a per-serial value.
  const itemFields = dto.fields.filter(
    (f) => f.scope === 'item' && f.role !== 'serialNumber',
  );

  const fields = dto.fields.map((f) => ({
    key: strip(f.token),
    label: f.label,
    type: f.type,
    required: f.required,
    scope: f.scope,
    ...(f.role ? { role: f.role } : {}),
    ...(f.section ? { section: f.section } : {}),
    ...(f.options ? { options: f.options } : {}),
  }));

  // Sections = distinct item `section` values, in first-seen order. Title defaults
  // to the key (English label); a later step can accept explicit section titles.
  const sectionKeys: string[] = [];
  for (const f of itemFields) {
    if (f.section && !sectionKeys.includes(f.section)) {
      sectionKeys.push(f.section);
    }
  }
  const sections = sectionKeys.map((key) => ({ key, title: key }));

  // Header fields → global. For a REGION template they read from snapshot.header (a
  // plain `field` — header fields genuinely span serials). For a FLAT template there is
  // no "elsewhere": the report IS one record, so EVERY field the inspector fills lives
  // on that record — header fields ALSO carry `source: 'record'` and resolve from the
  // record serial's inspectionData (step 3b). This closes the round-trip: step-3's form
  // renders every flat field and saves it into inspectionData, so export must read it
  // back from there, not from snapshot.header. Item fields likewise go global with
  // `source: 'record'` for flat (for a region template they live in export.regions
  // below, so this whole block stays byte-identical to before for region definitions).
  // A header field carrying a ROLE binds to the engine's existing computed token
  // (inspector→inspectedBy, supervisor→approvedBy, inspectionDate→reportDate) instead of
  // a user `field`, so its exported value is the transition-log derivation — never a
  // stored/entered value. A role-less header field maps to a plain `field` entry as before.
  const globalExport: CandidateExportEntry[] = [
    ...(dto.computed ?? []).map((c) => ({ token: c.token, computed: c.computed })),
    ...headerFields.map((f) => {
      // Only the HEADER roles map to a computed token. `ROLE_TO_COMPUTED` is keyed by
      // HeaderFieldRole, so an item role (serialNumber) mistakenly on a header field
      // looks up `undefined` and falls through to a plain `field` — the validator then
      // rejects that misplacement (role-item-scope), so it never actually writes.
      const computed = f.role
        ? ROLE_TO_COMPUTED[f.role as HeaderFieldRole]
        : undefined;
      return computed
        ? { token: f.token, computed }
        : {
            token: f.token,
            field: strip(f.token),
            ...(dto.region ? {} : { source: 'record' }),
          };
    }),
    ...(dto.region
      ? []
      : itemFields.map((f) => ({
          token: f.token,
          field: strip(f.token),
          source: 'record',
        }))),
  ];

  // Region present → a single region (id = internal constant) whose row export leads
  // with the serial's own token (`rowSerial`) followed by the item fields. No `marker`
  // on the region: the repeating row is inferred from these row tokens at export time.
  // Region absent (flat) → `regions: []` and no row-token export entries.
  const regions = dto.region
    ? [
        {
          id: REGION_ID,
          label: dto.region.label ?? REGION_ID,
          chunkSize: dto.region.chunkSize ?? null,
        },
      ]
    : [];
  const exportRegions: Record<string, CandidateExportEntry[]> = dto.region
    ? {
        [REGION_ID]: [
          { token: dto.region.marker, source: 'rowSerial' },
          ...itemFields.map((f) => ({ token: f.token, field: strip(f.token) })),
        ],
      }
    : {};

  // Rework trigger (slice A) — emit a rule ONLY when the author supplied one, in the
  // EXACT shape ReworkRulesInterpreter.parseUpsertRule reads. The fixed tokens (op: 'eq',
  // action: 'upsertChildReport', membership: 'allItemsMatching') are filled here because
  // the interpreter supports exactly one value of each; the interpreter-IGNORED fields
  // (id/scope/forbidChildDisposition) are deliberately NOT emitted. Absent → `rules: []`
  // (unchanged). Structural/semantic validity — non-empty field, known childType, etc. —
  // is the write-time gate's job (the interpreter dry-run in the validator), so this stays
  // total: it passes the authored values straight through without inspecting them.
  const rules: unknown[] = dto.reworkRule
    ? [
        {
          when: {
            field: dto.reworkRule.field,
            op: 'eq',
            value: dto.reworkRule.equals,
          },
          then: {
            action: 'upsertChildReport',
            childType: dto.reworkRule.childType,
            membership: 'allItemsMatching',
            ...(dto.reworkRule.reportNumberSuffix
              ? { reportNumberSuffix: dto.reworkRule.reportNumberSuffix }
              : {}),
          },
        },
      ]
    : [];

  return {
    formatVersion: 1,
    templateKey: meta.templateKey,
    templateVersion: meta.templateVersion,
    displayName: dto.displayName ?? meta.templateKey,
    sections,
    transforms: {},
    regions,
    ...(dto.disposition
      ? {
          disposition: {
            source: [dto.disposition.field],
            requiredForApproval: dto.disposition.requiredForApproval,
          },
        }
      : {}),
    ...((): { outcomes?: OutcomeMapping } => {
      const outcomes = normalizeOutcomes(dto.outcomes);
      return outcomes ? { outcomes } : {};
    })(),
    fields,
    export: {
      global: globalExport,
      regions: exportRegions,
    },
    rules,
  };
}
