import type { StatLine } from "@/domain/player";
import { STAT_FIELDS } from "@/domain/player";

const DIGEST_SEPARATOR = "|";

/**
 * A stable fingerprint of every numeric field on a stat line, in `STAT_FIELDS` order. A plain
 * join, not a hash: the value only needs to change when a number does, a join is directly
 * debuggable in `redis-cli`, and a hash buys nothing over a join for a 14-field line.
 */
export function statLineDigest(line: StatLine): string {
  return STAT_FIELDS.map((field) => line[field]).join(DIGEST_SEPARATOR);
}

export interface DiffResult {
  readonly changed: readonly StatLine[];
  readonly digests: ReadonlyMap<string, string>;
}

/**
 * Compares this tick's stat lines against the previous tick's digest snapshot (keyed by
 * `playerId`) and returns only the lines whose digest moved. A player with no prior digest
 * (never seen this week, or newly active) counts as changed — there is no "unchanged" to compare
 * it against.
 *
 * `digests` carries every incoming line's digest, not only the changed ones: that full map is
 * what the caller writes back as the next tick's snapshot. Returning only the changed digests
 * would drop every unchanged player from the snapshot and make them all look changed on the
 * following tick, which is the same bug as having no diff at all.
 */
export function diffStatLines(previous: ReadonlyMap<string, string>, next: readonly StatLine[]): DiffResult {
  const digests = new Map<string, string>();
  const changed: StatLine[] = [];
  for (const line of next) {
    const digest = statLineDigest(line);
    digests.set(line.playerId, digest);
    if (previous.get(line.playerId) !== digest) changed.push(line);
  }
  return { changed, digests };
}
