import { BadRequestException } from '@nestjs/common';
import { InspectionData } from '../common/inspection-data.types';

/** The minimal serial shape the gate reads (Prisma `SerialNumber` satisfies it). */
export interface SerialRow {
  serial: string;
  inspectionData: unknown;
}

/**
 * The minimal slice of a template definition (`Template.definitionJson`) the
 * approval gate reads. The full definition also carries transforms/regions/export
 * mappings/rules, which the gate ignores.
 */
export interface GateDefinition {
  fields: {
    key: string;
    scope: 'header' | 'item';
    required: boolean;
  }[];
  disposition?: {
    requiredForApproval?: boolean;
    source?: string[];
  };
}

export type GateOutcome =
  | { status: 'ok' }
  | { status: 'empty' }
  | {
      status: 'failed';
      missingDispositionSerials: string[];
      missingRequiredFields: Record<string, string[]>;
    };

/**
 * Dotted-path walk — IDENTICAL semantics to the legacy inline reduce, including
 * the `acc ?`-guard that short-circuits on a falsy intermediate node (a missing
 * section object yields `undefined`).
 */
export function walk(data: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, part) => (acc ? (acc as Record<string, unknown>)[part] : acc),
      data,
    );
}

/**
 * The ONE disposition resolver every server surface shares. A serial's disposition
 * lives wherever the template's definition declares (`disposition.source`, an ordered
 * first-truthy coalesce) — never a hardcoded field. This is the single reader the gate,
 * the revision snapshots, the export sort, and the serial/child column sync all funnel
 * through, so no two surfaces can disagree on where disposition comes from. A template
 * that declares no `source` (or none resolves) yields `null` — disposition unknown, which
 * the gate treats as "not required" unless `requiredForApproval` says otherwise.
 */
export function resolveDisposition(
  data: unknown,
  definition: { disposition?: { source?: string[] } } | null | undefined,
): string | null {
  const sources = definition?.disposition?.source ?? [];
  for (const path of sources) {
    const value = walk(data, path);
    if (value) return String(value);
  }
  return null;
}

/**
 * The fixed OUTCOME buckets, in evaluation order (first match wins). These are a
 * DISPLAY/COUNTING layer over the raw disposition token — distinct from the raw
 * `SerialDisposition` enum, which is untouched. A serial whose driving-token value maps
 * to no bucket is `'other'` (the catch-all). The order matters only when a template maps
 * different buckets off DIFFERENT tokens and a serial could satisfy more than one.
 */
export const OUTCOME_BUCKETS = ['pass', 'reject', 'actionRequired', 'hold'] as const;

/** A classified outcome bucket, including the catch-all `'other'`. */
export type OutcomeBucket = (typeof OUTCOME_BUCKETS)[number] | 'other';

/**
 * One bucket's mapping rule. `values` are the driving-token values that land in this
 * bucket (many→one). `token` is an OPTIONAL dotted path into a serial's inspection data
 * naming the driving token for THIS bucket; when omitted the bucket reads the template's
 * shared disposition source (via `resolveDisposition`) — the ergonomic common case, so a
 * template that maps every bucket off its disposition field never repeats the token.
 */
export interface OutcomeRule {
  token?: string;
  values: string[];
}

/** Per-bucket outcome mapping. Optional and may be PARTIAL — map only the buckets you
 *  need; every unmapped value falls to `'other'`. Absent entirely → everything is `'other'`. */
export type OutcomeMapping = Partial<Record<(typeof OUTCOME_BUCKETS)[number], OutcomeRule>>;

/**
 * The ONE outcome classifier every surface shares — the display/counting analogue of
 * `resolveDisposition`, and BUILT ON it. Given a serial's inspection data and the
 * template definition's `outcomes` mapping, it returns the bucket the serial lands in.
 *
 * Each mapped bucket's driving value is read from its own `token` (a dotted path), or —
 * when the bucket omits `token` — from the shared disposition source through
 * `resolveDisposition`, so the mapping never re-declares the disposition field. Matching is
 * case-insensitive (drill-pipe's options are upper-case; this also mirrors the legacy
 * `.toUpperCase()` compare the KPI chain used). No mapping, or no bucket matches → `'other'`.
 * There is no fallback to the old hardcoded PASS/REWORK/SCRAP/HOLD behaviour.
 */
export function classifyOutcome(
  data: unknown,
  definition:
    | { disposition?: { source?: string[] }; outcomes?: OutcomeMapping }
    | null
    | undefined,
): OutcomeBucket {
  const outcomes = definition?.outcomes;
  if (!outcomes) return 'other';
  for (const bucket of OUTCOME_BUCKETS) {
    const rule = outcomes[bucket];
    if (!rule || !Array.isArray(rule.values) || rule.values.length === 0) continue;
    const raw = rule.token ? walk(data, rule.token) : resolveDisposition(data, definition);
    if (raw === undefined || raw === null || raw === '') continue;
    const value = String(raw).toUpperCase();
    if (rule.values.some((v) => String(v).toUpperCase() === value)) return bucket;
  }
  return 'other';
}

/**
 * A required value is "missing" iff undefined / null / empty-string. Deliberately
 * NOT truthiness: boolean `false`, number `0`, and `'0'` / whitespace are PRESENT.
 */
function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

function finalize(
  missingDispositionSerials: string[],
  missingRequiredFields: Record<string, string[]>,
): GateOutcome {
  const failed =
    missingDispositionSerials.length > 0 ||
    Object.keys(missingRequiredFields).length > 0;
  return failed
    ? { status: 'failed', missingDispositionSerials, missingRequiredFields }
    : { status: 'ok' };
}

/**
 * Engine gate — derives the check purely from a template definition:
 *   - required item fields = fields where `scope === 'item' && required === true`,
 *     in definition array order (so `missingKeys` order matches the client contract);
 *   - disposition requirement from `disposition.requiredForApproval`, resolved through
 *     the shared `resolveDisposition` (first-truthy `disposition.source` coalesce) — the
 *     SAME reader every other server surface uses, so the gate can never diverge from
 *     what display/export/snapshot see.
 */
export function engineGate(
  definition: GateDefinition,
  serials: SerialRow[],
): GateOutcome {
  if (serials.length === 0) return { status: 'empty' };

  const requiredItemKeys = definition.fields
    .filter((f) => f.scope === 'item' && f.required === true)
    .map((f) => f.key);

  const dispRequired = definition.disposition?.requiredForApproval === true;

  const missingDispositionSerials: string[] = [];
  const missingRequiredFields: Record<string, string[]> = {};

  for (const sn of serials) {
    const data = (sn.inspectionData as InspectionData) || {};

    if (dispRequired) {
      const disposition = resolveDisposition(data, definition);
      if (!disposition) {
        missingDispositionSerials.push(sn.serial);
      }
    }

    const missingKeys = requiredItemKeys.filter((k) => isEmpty(walk(data, k)));
    if (missingKeys.length > 0) {
      missingRequiredFields[sn.serial] = missingKeys;
    }
  }

  return finalize(missingDispositionSerials, missingRequiredFields);
}

/**
 * The ONLY place a VALIDATION_FAILED response body is constructed. Both gates
 * funnel their outcome through here, so the two paths cannot differ in HTTP
 * shape, message, or key order — only in the data arrays. This is what makes the
 * "byte-for-byte identical error contract" guarantee structural rather than
 * incidental.
 */
export function enforce(outcome: GateOutcome): void {
  if (outcome.status === 'empty') {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Cannot request approval: No serial numbers added',
      missingDispositionSerials: [],
      missingRequiredFields: {},
    });
  }
  if (outcome.status === 'failed') {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Validation failed for one or more serial numbers.',
      missingDispositionSerials: outcome.missingDispositionSerials,
      missingRequiredFields: outcome.missingRequiredFields,
    });
  }
}
