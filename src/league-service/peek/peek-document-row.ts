// THE SHAPE OF A STORED PEEK DOCUMENT (peek document design §3.1, 2026-09-07). Types only, no
// database and no arithmetic, so the schema, the writer, the reader and the tests can all name the
// same shape without any of them importing the others — the same split `peek-facts-row.ts` made.
import type { Player } from "@research/domain/player";
import type { PlayerDossierFacts } from "@/league-service/dossier-facts";
import type { PlayerGameLogRow, PlayerSeasonTotals, PlayerWeekView } from "@/league-service/player-season-stats";
import type { KdefSeasonLine } from "@research/projections/kdef/season-lines";
import type { BoardReason } from "@research/projections/preseason/board";
import type { PlayerCapsuleView } from "@research/capsules/store";

/** A later document shape writes under a new source rather than overwriting rows a reader is
 *  already serving. */
export const PEEK_DOCUMENT_SOURCE = "peek_document_v1";

/**
 * ONE SEASON OF THE DOCUMENT — exactly the fields of `PlayerSeasonBody` that vary by season.
 *
 * EVERY available season is stored, not just the one a first open happens to want, so a season
 * switch in the peek is a client-side flip with no second fetch. That is the whole reason the
 * document is a list rather than a single season's numbers.
 */
export interface PeekDocumentSeason {
  readonly season: number;
  readonly weeks: readonly PlayerWeekView[];
  readonly pointsPerGame: number | null;
  readonly pointsPerGamePercentile: number | null;
  readonly log: readonly PlayerGameLogRow[];
  readonly totals: PlayerSeasonTotals | null;
  readonly kdefSeason: KdefSeasonLine | null;
}

/**
 * WHICH INPUTS PRODUCED THIS DOCUMENT, AND WHEN THEY WERE STAMPED (design §3.1).
 *
 * Two jobs at once. A reader can say what the document actually knows rather than taking every
 * number on faith, and a rebuild can tell whether anything moved. Every field is an ABSENCE when
 * its input is absent: a document built for a player the capsule sweep has never reached carries
 * `capsuleGeneratedAt: null`, which is the honest reading, never a stamp borrowed from elsewhere.
 */
export interface PeekDocumentBasis {
  /** The rule set this document's every fantasy point was scored under. */
  readonly scoringHash: string;
  /** `player_peek_facts.as_of` for the row that supplied the dossier, or `null` for a player with
   *  no row (a kicker, a team defense, an unranked name, a player the sweep has not reached). */
  readonly factsAsOf: string | null;
  /** The stored capsule's own generation stamp and the facts hash it was written against. */
  readonly capsuleGeneratedAt: string | null;
  readonly capsuleFactsHash: string | null;
  /** When the `capture_snapshots` rows behind the injury designation and the headlines were taken.
   *  `null` when the archive holds no capture of that feed yet, which is exactly the state in which
   *  the document carries no designation and no headline either. */
  readonly injuryCapturedAt: string | null;
  readonly newsCapturedAt: string | null;
  /** The highest league week `stat_weeks` had finalized when this was built, or `null` before the
   *  season's first result. */
  readonly lastFinalizedWeek: number | null;
  /** Which stores the season numbers were read from, so a reader can see which definition of a
   *  carry or a target produced them. */
  readonly sourceKeys: readonly string[];
}

/**
 * THE COMPLETE `PlayerSeasonBody` MINUS THE FACTS ONE LEAGUE CONTRIBUTES LIVE.
 *
 * What is NOT in here, and why each one is joined at read time instead:
 * - `ownedBy`: a roster move changes no document, so the holder is a live join and an add, a drop
 *   or a trade enqueues nothing (design §3.4's last row).
 * - `isMockLeague`: a property of the room, not of the player.
 * - the league's schedule length, which caps the CURRENT season's week axis and is applied by
 *   `hydratePeekDocument`.
 * - `laws`: the law registry is an in-memory read with no query behind it, and a document that
 *   froze it would go stale for no gain at all.
 */
export interface PeekDocument {
  readonly player: Player;
  readonly availableSeasons: readonly number[];
  readonly isRookie: boolean;
  readonly positionRank: number | null;
  readonly adpPercentile: number | null;
  readonly expertRank: number | null;
  readonly modelRank: number | null;
  readonly injuryDesignation: string | null;
  readonly news: readonly { readonly title: string; readonly link: string }[];
  readonly reasons: readonly BoardReason[];
  readonly capsule: PlayerCapsuleView | null;
  readonly dossier: PlayerDossierFacts | null;
  /** Newest season first, matching `availableSeasons` exactly. */
  readonly seasons: readonly PeekDocumentSeason[];
  /** The moment these facts were knowable, as an ISO instant. Surfaced by the peek. */
  readonly asOf: string;
  readonly basis: PeekDocumentBasis;
}

/** One stored row. `basis` is promoted out of the document as its own column so an operator can ask
 *  the table what a generation was built from without opening every blob, exactly as
 *  `player_peek_facts` promotes its touches rank. Both halves are written by one function. */
export interface PeekDocumentRow {
  readonly playerId: string;
  readonly season: number;
  readonly scoringHash: string;
  readonly document: PeekDocument;
  readonly basis: PeekDocumentBasis;
  readonly asOf: Date;
}
