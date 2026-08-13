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
  /** reserved row-metadata source; currently only 'rowSerial' (sn.serial) */
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
  regions: { id: string; marker: string; chunkSize: number | null }[];
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
 * The definition's single region, narrowed. Every drill-pipe definition carries
 * exactly one region and the backfill shape guard enforces `regions` is non-empty,
 * so `[0]` is always present. This makes that invariant explicit for the type checker
 * (noUncheckedIndexedAccess) instead of repeating the assertion in every caller; an
 * empty `regions` already threw at the first `region.*` access — this throws the same
 * case with a clearer message, one step earlier.
 */
function firstRegion(def: ExportDefinition): ExportDefinition['regions'][number] {
  const region = def.regions[0];
  if (!region) {
    throw new Error('export definition has no regions');
  }
  return region;
}

/** The per-row token keys for the (single) region — used for cell detection. */
export function engineRowTokenKeys(def: ExportDefinition): string[] {
  const region = firstRegion(def);
  return (def.export.regions[region.id] || []).map((e) => e.token);
}

/** Resolve the per-row token map for one serial (item scope = inspectionData). */
export function engineRowTokens(
  def: ExportDefinition,
  snapshot: Snapshot,
  serial: Snapshot['serialNumbers'][number],
): Record<string, string> {
  const region = firstRegion(def);
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
  const region = firstRegion(def);
  await expandRegionAndSubstitute(workbook, chunk, {
    marker: region.marker,
    rowTokenKeys: engineRowTokenKeys(def),
    globalTokens: engineGlobalTokens(def, snapshot),
    rowTokensFor: (serial) => engineRowTokens(def, snapshot, serial),
  });
}
