/**
 * KEYED IDENTITY REUSE for a derived list of row models (fluidity round, 2026-09-10). A list
 * derived with `useMemo` rebuilds every row object whenever any input changes, which defeats a
 * memoized row: sixty rows re-render because one player left. This hands back the PREVIOUS
 * object for every key whose fields are shallowly equal, so a memoized row sees the same props
 * and skips, and returns the previous array itself when nothing at all changed.
 *
 * Shallow on purpose: row models are built from primitives and shared references (the player
 * object from the room's own dictionary), which is exactly what a memoized row compares.
 */
export function reuseListItems<T extends object>(previous: readonly T[] | null, next: readonly T[], keyOf: (item: T) => string): readonly T[] {
  if (previous === null) return next;
  const held = new Map(previous.map((item) => [keyOf(item), item] as const));
  let unchanged = previous.length === next.length;
  const rows = next.map((item, index) => {
    const prior = held.get(keyOf(item));
    if (prior !== undefined && shallowEqual(prior, item)) {
      if (previous[index] !== prior) unchanged = false;
      return prior;
    }
    unchanged = false;
    return item;
  });
  return unchanged ? previous : rows;
}

function shallowEqual<T extends object>(a: T, b: T): boolean {
  const keysA = Object.keys(a) as (keyof T)[];
  const keysB = Object.keys(b) as (keyof T)[];
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => Object.is(a[key], b[key]));
}
