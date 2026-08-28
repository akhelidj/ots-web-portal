import * as ExcelJS from 'exceljs';
import { Snapshot } from '../common/inspection-data.types';
import { expandRegionAndSubstitute } from './mappings/xlsx-token-engine';
import {
  deriveReportDate,
  deriveActors,
} from './mappings/computed-token-helpers';

/**
 * Definition-driven export engine (Phase B2).
 *
 * Produces the same global + per-row token maps as the legacy drill-pipe mapper,
 * but derived entirely from a template's `definitionJson.export` map and
 * `definitionJson.transforms`, then handed to the SAME shared OOXML machinery
 * (`expandRegionAndSubstitute`). Proven byte-for-byte equivalent to
 * `legacyGlobalTokens` / `legacyRowTokens` by export-engine.equivalence.spec.ts.
 */

export interface ExportEntry {
  token: string;
  /** dotted path into the scope (header for global, inspectionData for a row) */
  field?: string;
  /** multiple paths fed to a compose transform (e.g. range min+max) */
  compose?: string[];
  /** first-truthy over these paths */
  coalesce?: string[];
  /** engine-computed value name (COMPUTED registry) */
  computed?: string;
  /** literal value */
  const?: string;
  /**
   * Row/record-metadata source. `'rowSerial'` → the serial number (sn.serial);
   * `'record'` → a flat template's record field, read from the record serial's
   * inspectionData by `field` (fork #2).
   */
  source?: string;
  /** named transform from definition.transforms */
  transform?: string;
  /** truthy-coalesce fallback when the resolved value is falsy (matches legacy `||`) */
  whenEmpty?: string;
}

export interface TransformSpec {
  kind: string;
  [param: string]: unknown;
}

export interface ExportDefinition {
  transforms: Record<string, TransformSpec>;
  // `id` keys `export.regions`; `chunkSize` bounds per-page serial count. No `marker`:
  // the repeating row is inferred from the region's row tokens (see xlsx-token-engine
  // step 4). Stored definitions may still carry a `marker` — it is simply ignored.
  regions: { id: string; chunkSize: number | null }[];
  export: {
    global: ExportEntry[];
    regions: Record<string, ExportEntry[]>;
  };
}

/** Engine-side computed resolvers (bespoke; share derivation with legacy). */
const COMPUTED: Record<string, (snapshot: Snapshot) => unknown> = {
  customerName: (s) => s.header.customerName,
  reportNumber: (s) => s.header.reportNumber,
  reportDate: (s) => deriveReportDate(s.header),
  inspectedBy: (s) => deriveActors(s).inspectedBy,
  approvedBy: (s) => deriveActors(s).approvedBy,
};

/**
 * The implemented computed-token names — the allow-list an ops-authored definition
 * may reference. Exported (additive; no behavior change) so write-time validation
 * constrains to the ACTUAL engine registry rather than a hand-copied list that
 * could drift. This is the single source of truth for "which `computed` names exist".
 */
export const COMPUTED_NAMES: readonly string[] = Object.keys(COMPUTED);

/** Dotted-path read, null-safe on missing intermediates. */
function walkPath(obj: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, p) =>
        acc == null ? undefined : (acc as Record<string, unknown>)[p],
      obj,
    );
}

/**
 * Apply a declared transform to a raw value. Each kind reproduces the exact
 * legacy expression it generalizes — including the deliberately preserved
 * `"undefined"` / `"[object Object]"` quirks (see KNOWN-ISSUES #13, #14).
 */
function applyTransform(
  def: ExportDefinition,
  name: string,
  raw: unknown,
): unknown {
  const t = def.transforms[name];
  if (!t) throw new Error(`Unknown transform: ${name}`);
  switch (t.kind) {
    case 'booleanMap':
      return raw === undefined || raw === null
        ? (t.whenNullish as string)
        : raw
          ? (t.whenTrue as string)
          : (t.whenFalse as string);
    case 'rangeCompose': {
      const [min, max] = (raw as unknown[]) ?? [];
      if (t.blankWhenMinEmpty && !min) return '';
      return `${min as string}${t.separator as string}${(max as string) || ''}`;
    }
    case 'objectListJoin': {
      const arr = (raw as Array<{ name?: unknown; number?: unknown }>) || [];
      const itemFormat = t.itemFormat as string;
      const suffixFormat = t.suffixFormat as string;
      // Mirrors `${e.name}${e.number ? ' #'+e.number : ''}` — String(undefined)
      // renders the literal "undefined" for a name-less entry (KNOWN-ISSUES #13).
      return arr
        .map((e) => {
          let s = itemFormat.replace('{name}', String(e.name));
          if (e.number) s += suffixFormat.replace('{number}', String(e.number));
          return s;
        })
        .join(t.separator as string);
    }
    case 'stringListJoin': {
      const arr = (raw as Array<string | { name?: unknown }>) || [];
      // Mirrors `typeof m==='string' ? m : m.name || m` — a name-less object
      // falls through to itself and joins as "[object Object]" (KNOWN-ISSUES #14).
      return arr
        .map((m) =>
          typeof m === 'string' ? m : (m as { name?: unknown }).name || m,
        )
        .join(t.separator as string);
    }
    default:
      throw new Error(`Unsupported transform kind: ${t.kind}`);
  }
}

/**
 * Resolve one export entry to a cell string. Algorithm (matches legacy exactly):
 *   raw = source value  ->  transform (optional)  ->  `raw || whenEmpty`  ->  String()
 * NOTE the truthy `||` — this is the EXPORT contract (legacy `field || ''`), the
 * opposite of the B1 gate's null/empty-only `isEmpty`.
 */
function resolveValue(
  def: ExportDefinition,
  entry: ExportEntry,
  scope: unknown,
  snapshot: Snapshot,
  serial: Snapshot['serialNumbers'][number] | undefined,
): string {
  let raw: unknown;
  if (entry.const !== undefined) {
    raw = entry.const;
  } else if (entry.computed) {
    raw = COMPUTED[entry.computed]?.(snapshot);
  } else if (entry.source === 'rowSerial') {
    raw = serial?.serial;
  } else if (entry.source === 'record') {
    // FLAT templates (fork #2): a record field's value lives in the single record
    // serial's inspectionData, read by its dotted key — the same value store the
    // region row path reads, but placed at a FIXED cell (global), not a cloned row.
    // The record serial is threaded in as `serial` by engineFlatTokens. See
    // phase-d-flat-templates-design.md §1c.
    raw = walkPath(serial?.inspectionData, entry.field ?? '');
  } else if (entry.coalesce) {
    raw = entry.coalesce.map((p) => walkPath(scope, p)).find((v) => Boolean(v));
  } else if (entry.compose) {
    raw = entry.compose.map((p) => walkPath(scope, p));
  } else if (entry.field) {
    raw = walkPath(scope, entry.field);
  }

  if (entry.transform) {
    raw = applyTransform(def, entry.transform, raw);
  }

  const whenEmpty = entry.whenEmpty ?? '';
  const out = raw || whenEmpty;
  return String(out ?? '');
}

/** Resolve the global (header-scope) token map. */
export function engineGlobalTokens(
  def: ExportDefinition,
  snapshot: Snapshot,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of def.export.global) {
    out[entry.token] = resolveValue(def, entry, snapshot.header, snapshot, undefined);
  }
  return out;
}

/**
 * Resolve the token map for a FLAT (region-less) definition. Identical to
 * engineGlobalTokens EXCEPT the single record serial is threaded through, so
 * `source: 'record'` entries resolve their value from the record's inspectionData
 * (fork #2). Header/computed/const/rowSerial entries resolve exactly as before —
 * passing the record as `serial` does not affect a `field` walk over `snapshot.header`
 * — so this subsumes engineGlobalTokens for any definition with no record entries.
 * The whole map is written to fixed cells (no row cloning) by the flat engineMap path.
 */
export function engineFlatTokens(
  def: ExportDefinition,
  snapshot: Snapshot,
  record: Snapshot['serialNumbers'][number] | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of def.export.global) {
    out[entry.token] = resolveValue(def, entry, snapshot.header, snapshot, record);
  }
  return out;
}

/**
 * The definition's repeating region, or `null` when there is none.
 *
 * A single-region (drill-pipe) definition carries exactly one region, so `[0]` is
 * present and every existing caller behaves exactly as before. A FLAT (region-less)
 * definition — Phase D flat templates — carries `regions: []`; this returns `null`
 * and the row readers below become no-ops, while `engineMap` takes a dedicated
 * header-only path. Returning `null` (instead of the former throw) is what makes the
 * engine general rather than drill-pipe-shaped; see phase-d-flat-templates-design.md.
 */
function optionalRegion(
  def: ExportDefinition,
): ExportDefinition['regions'][number] | null {
  return def.regions[0] ?? null;
}

/** The per-row token keys for the (single) region — used for cell detection. */
export function engineRowTokenKeys(def: ExportDefinition): string[] {
  const region = optionalRegion(def);
  if (!region) return []; // flat: no repeating region → no per-row token keys
  return (def.export.regions[region.id] || []).map((e) => e.token);
}

/** Resolve the per-row token map for one serial (item scope = inspectionData). */
export function engineRowTokens(
  def: ExportDefinition,
  snapshot: Snapshot,
  serial: Snapshot['serialNumbers'][number],
): Record<string, string> {
  const region = optionalRegion(def);
  if (!region) return {}; // flat: no repeating region → no per-row tokens
  const entries = def.export.regions[region.id] || [];
  const scope = serial.inspectionData || {};
  const out: Record<string, string> = {};
  for (const entry of entries) {
    out[entry.token] = resolveValue(def, entry, scope, snapshot, serial);
  }
  return out;
}

/**
 * Definition-driven mapper — same shape as `mapDrillPipeReportV1`, but every
 * hardcoded token/transform/marker comes from `def`. Drives the shared machinery.
 */
export async function engineMap(
  def: ExportDefinition,
  workbook: ExcelJS.Workbook,
  snapshot: Snapshot,
  chunk: Snapshot['serialNumbers'],
): Promise<void> {
  const region = optionalRegion(def);

  if (!region) {
    // FLAT (region-less) export. There is no repeating row to clone, so resolve only
    // the global/header token map and drive the SAME shared machinery with an EMPTY
    // chunk. `expandRegionAndSubstitute` already guards its row-cloning behind
    // `templateRowNumber !== -1 && chunk.length > 0` (xlsx-token-engine.ts), so an
    // empty chunk skips the byte-emitting regex row-clone path entirely and only the
    // global substitution (step 6) runs — no new lines in that fragile code. Passing
    // an empty `rowTokenKeys` ALSO makes step-4 row inference match nothing, so
    // `templateRowNumber` stays -1 regardless of the chunk — the skip is unconditional
    // on both counts. See phase-d-flat-templates-design.md §0/§1. The single record
    // serial (flat = one serial) is threaded into engineFlatTokens so `source: 'record'`
    // fields resolve from its inspectionData (fork #2); header/computed tokens as usual.
    await expandRegionAndSubstitute(workbook, [], {
      rowTokenKeys: [],
      globalTokens: engineFlatTokens(def, snapshot, chunk[0]),
      rowTokensFor: () => ({}),
    });
    return;
  }

  await expandRegionAndSubstitute(workbook, chunk, {
    rowTokenKeys: engineRowTokenKeys(def),
    globalTokens: engineGlobalTokens(def, snapshot),
    rowTokensFor: (serial) => engineRowTokens(def, snapshot, serial),
  });
}
