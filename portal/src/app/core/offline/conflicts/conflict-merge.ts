/**
 * Pure helpers for the sync-conflict merge screen. No I/O, no Angular: everything here is
 * deterministic and unit-tested, so the screen itself only wires data to these functions.
 *
 * Model: a conflicted queued edit ("mine") is compared with the record as the server holds it
 * now ("server"), leaf by leaf. The user picks, per differing leaf, whose value wins. The
 * result is a PARTIAL update payload: only top-level keys that actually change are sent, and
 * each is sent whole (server value overlaid with the chosen leaves) because the API replaces
 * a top-level JSON value rather than merging into it.
 */
import { sameContent } from '@portal/shared/utils/same-content';

export type Side = 'mine' | 'server';

export interface FieldDifference {
  /** Stable id for the leaf (the path, JSON-encoded). */
  id: string;
  /** Path of keys from the document root to the leaf. */
  path: string[];
  mine: unknown;
  /** The server's value; `undefined` when the server has no value at this path. */
  server: unknown;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Leaves of a document: scalars, arrays and nulls are leaves; plain objects recurse. */
export function flattenLeaves(
  doc: Record<string, unknown>,
  prefix: string[] = [],
): { path: string[]; value: unknown }[] {
  const out: { path: string[]; value: unknown }[] = [];
  for (const [key, value] of Object.entries(doc)) {
    const path = [...prefix, key];
    if (isPlainObject(value) && Object.keys(value).length > 0) {
      out.push(...flattenLeaves(value, path));
    } else {
      out.push({ path, value });
    }
  }
  return out;
}

export function getPath(doc: unknown, path: string[]): unknown {
  let cur: unknown = doc;
  for (const key of path) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function setPath(
  target: Record<string, unknown>,
  path: string[],
  value: unknown,
) {
  let cur = target;
  path.slice(0, -1).forEach((key) => {
    if (!isPlainObject(cur[key])) cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  });
  cur[path[path.length - 1] as string] = clone(value);
}

/**
 * Leaves where the user's version differs from the server's. A leaf only the server has is
 * not listed: the user's edit never touched it, so the server value simply stays.
 */
export function diffDocuments(
  mine: Record<string, unknown>,
  server: Record<string, unknown>,
): FieldDifference[] {
  const diffs: FieldDifference[] = [];
  for (const leaf of flattenLeaves(mine)) {
    const serverValue = getPath(server, leaf.path);
    if (!sameContent(leaf.value, serverValue)) {
      diffs.push({
        id: JSON.stringify(leaf.path),
        path: leaf.path,
        mine: leaf.value,
        server: serverValue,
      });
    }
  }
  return diffs;
}

/**
 * The partial update payload for the chosen sides. Only top-level keys with at least one
 * leaf resolved to "mine" are included; each carries the server's current value overlaid
 * with exactly the chosen leaves. Returns `{}` when everything resolved to the server.
 */
export function buildMergedPayload(
  server: Record<string, unknown>,
  differences: FieldDifference[],
  choices: Record<string, Side>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const diff of differences) {
    if ((choices[diff.id] ?? 'mine') !== 'mine') continue;
    const [top] = diff.path;
    if (top === undefined) continue;
    if (!(top in payload)) payload[top] = clone(server[top]);
    if (diff.path.length === 1) {
      payload[top] = clone(diff.mine);
    } else {
      if (!isPlainObject(payload[top])) payload[top] = {};
      setPath(payload as Record<string, unknown>, diff.path, diff.mine);
    }
  }
  return payload;
}

/**
 * Shift the numeric `version` of later queued edits to the same record after their
 * predecessor was rebased onto the server's current version, so the chain stays consistent
 * (each offline edit expects the version its predecessor leaves behind).
 */
export function rebaseVersion(
  dependentVersion: unknown,
  oldBase: number,
  newBase: number,
): unknown {
  return typeof dependentVersion === 'number'
    ? dependentVersion + (newBase - oldBase)
    : dependentVersion;
}

/** `a › b › c` for display. */
export function pathLabel(path: string[]): string {
  return path.join(' › ');
}
