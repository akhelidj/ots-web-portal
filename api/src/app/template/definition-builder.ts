import { BadRequestException } from '@nestjs/common';
import {
  DefineTemplateDto,
  CandidateDefinition,
  CandidateExportEntry,
} from './definition-authoring.types';

/**
 * Phase D step 2a — ops description → engine-shaped candidate definition.
 *
 * PURE and TOTAL for well-formed input: given a syntactically-valid DTO it always
 * produces a candidate in the exact shape `export-engine.ts` / `approval-gate.ts`
 * read. It throws `BadRequestException` only for structurally-broken input (missing
 * region/marker, non-array fields, duplicate tokens) — the SEMANTIC checks (types,
 * computed allow-list, tokens-in-sheet, engine dry-run) live in the validator.
 *
 * Field KEY derivation: the data key is the token stripped of its braces, e.g.
 * `"{{poNumber}}"` → `"poNumber"`, `"{{b_ts}}"` → `"b_ts"`. This makes the
 * export-entry field binding trivially consistent (entry.field === derived key)
 * and frees ops from inventing dotted keys.
 *
 * EQUIVALENCE BOUNDARY vs. the hand-authored drill-pipe definition — the ops flow
 * covers: field descriptions (label/type/required/scope/section/options), the
 * header→global / item→region token bindings, the single region + its serial
 * marker, an optional disposition source, and computed token bindings (5-key set).
 * It does NOT author: value transforms (drill-pipe's boolFlag/boolCheckbox/range/
 * list joins), rework `rules`, or multi-path coalesce/compose export entries. A
 * definition it produces is engine-VALID; it reproduces drill-pipe only on the
 * transform-free, single-path fields.
 */
export function buildDefinition(
  meta: { templateKey: string; templateVersion: number },
  dto: DefineTemplateDto,
): CandidateDefinition {
  if (!dto || typeof dto !== 'object') {
    throw new BadRequestException('A definition body is required.');
  }
  if (!dto.region || typeof dto.region.marker !== 'string' || !dto.region.id) {
    throw new BadRequestException(
      'A single repeating region with an id and a marker token is required.',
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
  const itemFields = dto.fields.filter((f) => f.scope === 'item');

  const fields = dto.fields.map((f) => ({
    key: strip(f.token),
    label: f.label,
    type: f.type,
    required: f.required,
    scope: f.scope,
    ...(f.scope === 'item' ? { region: dto.region.id } : {}),
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

  const globalExport: CandidateExportEntry[] = [
    ...(dto.computed ?? []).map((c) => ({ token: c.token, computed: c.computed })),
    ...headerFields.map((f) => ({ token: f.token, field: strip(f.token) })),
  ];

  const regionExport: CandidateExportEntry[] = [
    { token: dto.region.marker, source: 'rowSerial' },
    ...itemFields.map((f) => ({ token: f.token, field: strip(f.token) })),
  ];

  return {
    formatVersion: 1,
    templateKey: meta.templateKey,
    templateVersion: meta.templateVersion,
    displayName: dto.displayName ?? meta.templateKey,
    sections,
    transforms: {},
    regions: [
      {
        id: dto.region.id,
        label: dto.region.label ?? dto.region.id,
        marker: dto.region.marker,
        chunkSize: dto.region.chunkSize ?? null,
      },
    ],
    ...(dto.disposition
      ? {
          disposition: {
            source: [dto.disposition.field],
            requiredForApproval: dto.disposition.requiredForApproval,
          },
        }
      : {}),
    fields,
    export: {
      global: globalExport,
      regions: { [dto.region.id]: regionExport },
    },
    rules: [],
  };
}
