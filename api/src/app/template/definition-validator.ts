import {
  engineGlobalTokens,
  engineFlatTokens,
  engineRowTokens,
  engineRowTokenKeys,
  COMPUTED_NAMES,
  ExportDefinition,
} from '../export/export-engine';
import { engineGate, GateDefinition } from '../workflow/approval-gate';
import { selectUpsertRule } from '../child-reports/rework-rules.interpreter';
import { Snapshot } from '../common/inspection-data.types';
import { InspectionReportStatus } from '@prisma/client';
import {
  CandidateDefinition,
  ROLE_TO_COMPUTED,
} from './definition-authoring.types';

/** The known system roles a header field may carry (see FieldRole / ROLE_TO_COMPUTED). */
const VALID_ROLES = new Set(Object.keys(ROLE_TO_COMPUTED));

/**
 * Phase D step 2a — write-time validation gate (the untrusted-input boundary).
 *
 * Seven checks; the WHOLE candidate is refused on the first failure — never a
 * partial write. Six are shallow structural checks; the seventh is an ENGINE
 * DRY-RUN: the candidate is fed through the very readers export + gate use at
 * runtime (`engineGlobalTokens` / `engineRowTokens` / `engineRowTokenKeys` /
 * `engineGate`), so validation cannot drift from what the engine actually accepts —
 * the engine is the oracle. A definition that survives all seven cannot blank the
 * form (renderable types enforced) or crash export/gate (dry-run clean).
 *
 * PURE: no I/O. The endpoint runs it AFTER building the candidate and re-extracting
 * the workbook's tokens, and writes only when it returns `{ ok: true }`.
 */

export type ValidationOutcome =
  | { ok: true }
  | { ok: false; check: string; reason: string };

/**
 * Portal-renderable field types (must match the form's input branches).
 * `object-list` (Phase D step 2) is the generic array type: a repeated
 * `{ name, number? }` group the header/serial forms render with a structured
 * array editor and the export transforms consume as an array. Any template's
 * array field uses it — there is no field-name special-casing.
 */
const RENDERABLE_TYPES = new Set([
  'text',
  'number',
  'boolean',
  'select',
  'date',
  'object-list',
]);

/**
 * A minimal, fully-populated snapshot for the dry-run. Values are irrelevant (the
 * dry-run asserts the readers don't THROW, not what they return); every required
 * `Snapshot` field is present so the engine's computed helpers run without error.
 */
const DRY_RUN_SNAPSHOT: Snapshot = {
  header: {
    id: 'dry-run',
    poNumber: 'PO',
    reportNumber: 'RPT',
    status: InspectionReportStatus.DRAFT,
    customerId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    grade: null,
    range: null,
    weight: null,
    nomWT: null,
    nomOD: null,
    nomID: null,
    connection: null,
    inspectionAddress: null,
    standardUsed: null,
    inspectorComment: null,
    equipmentUsed: null,
    inspectionMethod: null,
  },
  template: { key: 'dry-run', version: 1, hash: 'dry-run', versionId: null },
  serialNumbers: [],
  childReports: [],
  transitionLogs: [],
  users: [],
};

const DRY_RUN_SERIAL = {
  id: 'dry-run-serial',
  serial: 'DRYRUN-001',
  inspectionData: {} as Snapshot['serialNumbers'][number]['inspectionData'],
  disposition: null,
  updatedAt: new Date(0),
};

/**
 * Collect every token literal the candidate references (export entries). The serial's
 * own token is among `export.regions` (its `rowSerial` entry), so it is covered here —
 * there is no separate region "marker" to collect any more.
 */
export function referencedTokens(def: CandidateDefinition): string[] {
  const tokens: string[] = [];
  for (const e of def.export.global) tokens.push(e.token);
  for (const entries of Object.values(def.export.regions)) {
    for (const e of entries) tokens.push(e.token);
  }
  return tokens;
}

export function validateDefinition(
  candidate: CandidateDefinition,
  extractedTokens: ReadonlySet<string>,
): ValidationOutcome {
  // 6 — zero or one repeating region. Flat templates carry `regions: []` (engine flat
  // path); region templates carry exactly one (engine reads regions[0]). Two or more is
  // still unsupported — the engine only ever consults the first.
  if (!Array.isArray(candidate.regions) || candidate.regions.length > 1) {
    return {
      ok: false,
      check: 'single-region',
      reason: `At most one repeating region is supported; got ${
        candidate.regions?.length ?? 0
      }.`,
    };
  }

  for (const f of candidate.fields) {
    // 2 — type in the portal-renderable set (rejects list types and anything the form can't render).
    if (!RENDERABLE_TYPES.has(f.type)) {
      return {
        ok: false,
        check: 'types-renderable',
        reason: `Field "${f.key}" has unsupported type "${f.type}". Allowed: text, number, boolean, select, date, object-list.`,
      };
    }
    // 3 — required is a boolean.
    if (typeof f.required !== 'boolean') {
      return {
        ok: false,
        check: 'required-boolean',
        reason: `Field "${f.key}" has a non-boolean "required".`,
      };
    }
    // 4 — a select carries non-empty options.
    if (
      f.type === 'select' &&
      (!Array.isArray(f.options) || f.options.length === 0)
    ) {
      return {
        ok: false,
        check: 'select-options',
        reason: `Select field "${f.key}" must declare non-empty options.`,
      };
    }
  }

  // 4b — field roles: header-scope only, a known role, and each role at most once. Roles
  // are OPTIONAL — a definition with none skips this entirely. A roled field's value is
  // derived from a computed token (the builder wired it), never user-entered.
  const seenRoles = new Set<string>();
  for (const f of candidate.fields) {
    const role: string | undefined = f.role;
    if (role === undefined) continue;
    if (!VALID_ROLES.has(role)) {
      return {
        ok: false,
        check: 'role-known',
        reason: `Field "${f.key}" has unknown role "${role}". Allowed: ${[...VALID_ROLES].join(', ')}.`,
      };
    }
    if (f.scope !== 'header') {
      return {
        ok: false,
        check: 'role-header-scope',
        reason: `Field "${f.key}" carries role "${role}" on an item-scope field; roles are header-scope only.`,
      };
    }
    if (seenRoles.has(role)) {
      return {
        ok: false,
        check: 'role-unique',
        reason: `Role "${role}" is used by more than one field; each role may appear at most once.`,
      };
    }
    seenRoles.add(role);
  }

  // 5 — every computed export entry names one of the engine's implemented computed keys.
  const allowedComputed = new Set(COMPUTED_NAMES);
  for (const e of candidate.export.global) {
    if (e.computed !== undefined && !allowedComputed.has(e.computed)) {
      return {
        ok: false,
        check: 'computed-allowlist',
        reason: `Unknown computed "${e.computed}". Allowed: ${COMPUTED_NAMES.join(', ')}.`,
      };
    }
  }

  // 1 — every referenced token actually exists in the workbook's extracted set.
  const missing = referencedTokens(candidate).filter(
    (t) => !extractedTokens.has(t),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      check: 'tokens-exist',
      reason: `These tokens are not present in the workbook: ${[...new Set(missing)].join(', ')}.`,
    };
  }

  // 7 — engine dry-run: the same readers export + gate use at runtime. Any throw
  // (unknown/unsupported transform, …) refuses the whole candidate. Both shapes are
  // exercised: the region readers (no-ops on a flat candidate) AND the flat token
  // resolver (engineFlatTokens — the exact path the flat export runs, threading the
  // dry-run record so `source: 'record'` fields resolve). The engine is the oracle:
  // a candidate the flat/region engine would reject here cannot be written.
  try {
    const exportDef = candidate as unknown as ExportDefinition;
    engineGlobalTokens(exportDef, DRY_RUN_SNAPSHOT);
    engineFlatTokens(exportDef, DRY_RUN_SNAPSHOT, DRY_RUN_SERIAL);
    engineRowTokenKeys(exportDef);
    engineRowTokens(exportDef, DRY_RUN_SNAPSHOT, DRY_RUN_SERIAL);
    engineGate(candidate as unknown as GateDefinition, [
      { serial: DRY_RUN_SERIAL.serial, inspectionData: {} },
    ]);
  } catch (err) {
    return {
      ok: false,
      check: 'engine-dry-run',
      reason: `The engine rejected the definition: ${(err as Error).message}`,
    };
  }

  // 8 — rework-rules dry-run: feed the candidate's rules through the REAL interpreter
  // selector (`selectUpsertRule`) — the very same pure parse the live
  // ChildReportsService.syncReworkChildReport runs. Any malformed rule (unknown op or
  // action, absent/empty when.field, missing when.value, unknown childType/membership, or
  // 2+ upsert rules) throws and refuses the whole candidate at WRITE time, so a broken
  // rework rule can never reach a live report and fail at rework-sync runtime. The
  // interpreter is the oracle: this check cannot drift from what the live path accepts.
  try {
    selectUpsertRule(candidate.rules);
  } catch (err) {
    return {
      ok: false,
      check: 'rework-rules',
      reason: `The rework rule is invalid: ${(err as Error).message}`,
    };
  }

  return { ok: true };
}
