/**
 * WHAT HAS HAPPENED BETWEEN TWO MANAGERS, as a shape and a key — pure, browser-safe, and here
 * rather than in `@/league-service` because BOTH sides need it: the service counts the games and
 * the rival card reads the pair off the map. Room code may not value-import a service module (the
 * client boundary, `docs/league.md`), and a key builder that existed only on the server would
 * force the card to spell `${a}|${b}` by hand, which is the same key written twice.
 */

/**
 * The record between two managers, from the FIRST team's point of view. `4 and 1` is
 * `{ wins: 4, losses: 1 }` for the team the key names first; the same pair keyed the other way
 * round carries the mirror image, so a card never has to work out which side it is on.
 */
export interface HeadToHeadRecord {
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  /**
   * THE BASIS, IN THE SAME OBJECT AS THE NUMBER (P11). Every season these games were played in,
   * ascending, so the card can say what the record covers rather than implying "ever".
   *
   * Today that is always exactly one season, and this is the honest way to say so: a `matchups`
   * row has no season of its own, and there is no season-rollover mechanic — every league on this
   * platform belongs to the single season `LEAGUE_CONFIG.season.startedAt` opens (that constant's
   * own docblock is the ruling). An array rather than a number because when rollover ships, this
   * is the one place that has to learn to say "2023 to 2026", and nothing downstream changes
   * shape.
   */
  readonly seasons: readonly number[];
}

/** The one key shape for a directed pair. Never built by hand at a call site. */
export function headToHeadKey(teamId: string, opponentTeamId: string): string {
  return `${teamId}|${opponentTeamId}`;
}
