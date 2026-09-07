import type { PlayerDossierFacts } from "@/league-service/dossier-facts";

/**
 * THE PRECOMPUTED PEEK ROW'S OWN SHAPE, with no database import of its own — so `db/schema.ts` can
 * type the JSON columns against it (`$type<...>()`) without a runtime import cycle back through the
 * reader and writer that live in `peek-facts.ts`. The same one-way type-only arrangement
 * `db/schema.ts` already uses for `GradeComponents` and `PrizeTable`.
 */

/** The writer's stamp, so a row can never be mistaken for something another version produced. */
export const PEEK_FACTS_SOURCE = "peek_facts_v1";

/**
 * HOW MANY FINISHED SEASONS BEFORE THE PRODUCT SEASON a player card offers, at most.
 *
 * ONE CONSTANT FOR BOTH SIDES, and it has to be. The writer stores `prior_seasons_held` as the
 * subset of THESE candidate seasons the store actually holds a week of, and the peek builds its
 * `availableSeasons` list from that array. A reader looking back four seasons over an array written
 * three deep would silently show a manager one fewer season than the store has, with nothing in the
 * data to say which side was wrong. It lived as a private constant in `league-service/player.ts`
 * until the precompute round (2026-09-07) gave the number a second reader.
 */
export const PEEK_HISTORY_SEASONS = 3;

/**
 * WHAT EVERY STORED NUMBER WAS COMPUTED AGAINST — the honesty half of the row, and never optional.
 * A rank without its population is a number a reader has to take on faith, and this product does
 * not ask anyone to.
 */
export interface PeekFactsBasis {
  /** The season the color facts describe, which is the product season minus one. */
  readonly priorSeason: number;
  /** Every observation source key that actually fed this row. A gap season names the play-by-play
   *  pair rather than the published weekly feed, so a reader can see which definition of a carry
   *  produced the touches number. */
  readonly sourceKeys: readonly string[];
  /** How many ACTIVE peers at his position the ranks in this row were taken over
   *  (`capsules/peers.ts`'s own membership rule), never the historical universe's count. */
  readonly peerPopulation: number;
  /** How many players the prior-season stat-line read produced a story for, across every position.
   *  ZERO is the state the touches refusal exists for: a rank taken over an empty line set is not
   *  a rank, it is a number with nothing behind it. */
  readonly priorSeasonPlayerCount: number;
  /** Why a fact on this row is absent, one sentence each. Empty when nothing was refused. */
  readonly refusals: readonly string[];
  /** The scoring format `lastSeasonLine` and every rate on the dossier were computed under. */
  readonly scoringLabel: string;
}

/**
 * LAST SEASON, LEAGUE-AGNOSTIC. Points, games and points per game under this product's standard PPR
 * format, which is what makes the number storable at all: a fantasy point is a property of a player
 * inside a rule set, so the figure scored under the CALLER's own league stays a live computation
 * (`league-service/player.ts`'s own `priorSeasonStats`) and this is the shared basis beside it.
 */
export interface PeekLastSeasonLine {
  readonly season: number;
  readonly points: number;
  readonly games: number;
  readonly pointsPerGame: number;
}

/** One `player_peek_facts` row, as the writer builds it and the reader hands it back. */
export interface PeekFactsRow {
  /** A PRODUCT player id (`players.id`), the space the peek itself asks in. */
  readonly playerId: string;
  readonly season: number;
  /** Everything the peek's dossier renders, precomputed. One blob rather than a column per field:
   *  it is written and read as one object, and splitting it would create twelve places for the
   *  writer and the reader to disagree. */
  readonly dossier: PlayerDossierFacts;
  /** PROMOTED OUT OF `dossier` so the refusal is queryable — an operator can ask the table how many
   *  players have a touches rank without opening every JSON blob. Written by one function together
   *  with the blob, so the two cannot disagree, and pinned by a test that reads both. */
  readonly touchesRank: number | null;
  readonly touchesQualifierCount: number | null;
  /** Which of `PEEK_HISTORY_SEASONS`' candidate seasons the store holds at least one week of for
   *  him, newest first. Empty is a real answer, not a missing one. */
  readonly priorSeasonsHeld: readonly number[];
  readonly lastSeasonLine: PeekLastSeasonLine | null;
  readonly basis: PeekFactsBasis;
  /** The moment these facts were knowable. The peek reads the latest row with `as_of <= now`. */
  readonly asOf: Date;
}
