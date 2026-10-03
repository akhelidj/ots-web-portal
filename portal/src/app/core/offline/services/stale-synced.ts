/**
 * "The server is the truth" for a successful full pull.
 *
 * A pull only ever upserts what the server returned, so a row that was deleted on the
 * server (or never existed there any more) would stay in the offline cache forever and
 * be shown as real data. After a pull that SUCCEEDED, the cached rows that are
 * already synced yet absent from the server's answer are stale and can go.
 *
 * Never stale — kept no matter what the server said:
 *  - rows with unsynced local work (PENDING / CONFLICT / ERROR, PENDING_CREATE/UPDATE);
 *  - rows with a temporal id (`local-…`), which the server cannot know about yet.
 *
 * Only call this with the server's COMPLETE answer for the scope being compared (the
 * whole list, or every child of one parent) — never with a filtered or failed response.
 */
const CLEAN_STATES: ReadonlySet<string | undefined> = new Set([
  'SYNCED',
  'CLEAN',
]);

export function staleSyncedIds<T extends { id: string; syncState?: string }>(
  local: readonly T[],
  serverIds: Iterable<string>,
): string[] {
  const present = new Set(serverIds);
  return local
    .filter(
      (row) =>
        !present.has(row.id) &&
        !row.id.startsWith('local-') &&
        CLEAN_STATES.has(row.syncState),
    )
    .map((row) => row.id);
}
