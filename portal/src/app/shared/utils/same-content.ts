/**
 * Structural (JSON) equality for plain data from the API / IndexedDB. Used to ignore
 * a re-delivered, content-identical object (e.g. after a window-focus re-hydration) so
 * a form bound to it isn't rebuilt and the user's in-progress edits aren't wiped.
 */
export function sameContent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
