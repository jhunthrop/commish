// WHICH PLAYERS A HARVEST ACTUALLY MOVED (peek document design §3.4, row four, 2026-09-07).
//
// The harvest already knows whether a FEED changed: `captureOnce` digests the payload and writes no
// row when it matches the last one. What it has never known is WHO changed inside a feed that did,
// and that is the difference between rebuilding one player's document and rebuilding seven hundred.
//
// PURE. It reads two payloads the caller already has and names what moved between them.
//
// A FIRST CAPTURE MOVES NOBODY. With no previous capture there is no claim the new one contradicts,
// so the honest answer is an empty diff rather than "everyone changed". The nightly and post-finalize
// passes rebuild everybody anyway, so nothing is lost by refusing to call the first sighting of a
// feed a change.

/** One archived capture, as the diff needs it. */
export interface HarvestCapture {
  readonly payload: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Every current injury designation in one `tank01_injuries_by_date` payload, keyed by the provider's
 * player id — which IS this product's own `players.id`, the same join `injuries.ts` makes.
 *
 * A player the feed does not name is ABSENT from the map rather than mapped to an empty string:
 * absence means healthy as far as the source says, and it is exactly what the diff below has to be
 * able to tell apart from a designation that changed.
 */
export function injuryDesignationsIn(capture: HarvestCapture): ReadonlyMap<string, string> {
  const list = asRecord(capture.payload).injList;
  const designations = new Map<string, string>();
  if (!Array.isArray(list)) return designations;
  for (const raw of list) {
    const entry = asRecord(raw);
    if (typeof entry.playerID === "string" && typeof entry.designation === "string" && entry.designation !== "") {
      designations.set(entry.playerID, entry.designation);
    }
  }
  return designations;
}

/**
 * Every headline link in one `tank01_news` payload, grouped by the name the feed's own
 * "Name: sentence" title convention puts in front of the colon — the identical join `news.ts` makes
 * to decide whose card a story belongs on, so a name this diff reports is a name whose document
 * actually carries those headlines.
 */
export function newsLinksIn(capture: HarvestCapture): ReadonlyMap<string, ReadonlySet<string>> {
  const body = capture.payload;
  const byName = new Map<string, Set<string>>();
  if (!Array.isArray(body)) return byName;
  for (const raw of body) {
    const entry = asRecord(raw);
    if (typeof entry.title !== "string" || typeof entry.link !== "string" || entry.link === "") continue;
    const colonIndex = entry.title.indexOf(":");
    if (colonIndex === -1) continue;
    const name = entry.title.slice(0, colonIndex);
    const links = byName.get(name);
    if (links === undefined) byName.set(name, new Set([entry.link]));
    else links.add(entry.link);
  }
  return byName;
}

/**
 * WHOSE DESIGNATION MOVED, by product player id, sorted.
 *
 * Three kinds of move and all three count, because all three change what a card says: a designation
 * that changed value, one the feed added, and one the feed DROPPED. The drop is the one an ordinary
 * "what is in the new payload" comparison misses, and it is the most consequential of the three: a
 * player disappearing from the injury report is the feed saying he is healthy again.
 */
export function harvestDesignationDiff(previous: HarvestCapture | null, next: HarvestCapture): readonly string[] {
  if (previous === null) return [];
  const before = injuryDesignationsIn(previous);
  const after = injuryDesignationsIn(next);
  const moved = new Set<string>();
  for (const [playerId, designation] of after) if (before.get(playerId) !== designation) moved.add(playerId);
  for (const playerId of before.keys()) if (!after.has(playerId)) moved.add(playerId);
  return [...moved].sort();
}

/**
 * WHOSE HEADLINES MOVED, by the NAME the feed titles them under, sorted. The caller resolves those
 * names to product player ids, since the feed carries no id of its own.
 *
 * A name whose set of links is not identical between the two captures has moved, in either
 * direction: a story added, a story dropped off the end of the feed's window, or a story replaced.
 * The document carries the links themselves, so the set is exactly the right thing to compare.
 */
export function harvestNewsDiff(previous: HarvestCapture | null, next: HarvestCapture): readonly string[] {
  if (previous === null) return [];
  const before = newsLinksIn(previous);
  const after = newsLinksIn(next);
  const moved = new Set<string>();
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    if (!sameLinks(before.get(name), after.get(name))) moved.add(name);
  }
  return [...moved].sort();
}

function sameLinks(before: ReadonlySet<string> | undefined, after: ReadonlySet<string> | undefined): boolean {
  const left = before ?? new Set<string>();
  const right = after ?? new Set<string>();
  if (left.size !== right.size) return false;
  for (const link of left) if (!right.has(link)) return false;
  return true;
}
