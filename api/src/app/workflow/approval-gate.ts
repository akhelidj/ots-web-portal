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
function walk(data: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, part) => (acc ? (acc as Record<string, unknown>)[part] : acc),
      data,
    );
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
 *   - disposition requirement from `disposition.requiredForApproval`, read from the
 *     first truthy `disposition.source` path (the same coalesce as legacy —
 *     NOTE it reads `source`, never `syncedFrom`/`body.emiResult`).
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
  const dispSources = definition.disposition?.source ?? [];

  const missingDispositionSerials: string[] = [];
  const missingRequiredFields: Record<string, string[]> = {};

  for (const sn of serials) {
    const data = (sn.inspectionData as InspectionData) || {};

    if (dispRequired) {
      const disposition = dispSources
        .map((p) => walk(data, p))
        .find((v) => Boolean(v));
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
