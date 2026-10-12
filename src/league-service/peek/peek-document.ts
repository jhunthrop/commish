// THE TWO PURE HALVES OF THE PEEK DOCUMENT (peek document design §3.2 and §3.3, 2026-09-07):
// `buildPeekDocument` assembles one, offline, from reads that have already happened, and
// `hydratePeekDocument` turns a stored one plus the three facts a league contributes into the body
// the screen draws. Neither touches a database, which is what lets the writer, the request path and
// the tests all run the same assembly.
import type { Player } from "@/domain/player";
import type { PlayerLeagueDraftPhase, PlayerOwner, PlayerSeasonBody } from "@/league-service/player-body";
import {
  pointsPerGameOf,
  totalsFromLog,
  type PlayerGameLogRow,
  type PlayerSeasonStats,
  type PlayerWeekView,
} from "@/league-service/player-season-stats";
import type { PlayerDossierFacts } from "@/league-service/dossier-facts";
import { chipEligibleLaws, registry } from "@/projections/laws/registry";
import type { BoardReason } from "@/projections/preseason/board";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import type { PlayerCapsuleView } from "@/capsules/store";
import type { PeekDocument, PeekDocumentBasis, PeekDocumentSeason } from "./peek-document-row";

/** Everything one document is built from. Every read it needs has already happened. */
export interface PeekDocumentInput {
  readonly player: Player;
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
  /** Newest season first. A season with no stats for him never enters this list, which is what
   *  makes `availableSeasons` a statement about what the stores actually hold. */
  readonly seasons: readonly { readonly season: number; readonly stats: PlayerSeasonStats }[];
  readonly asOf: Date;
  readonly basis: PeekDocumentBasis;
}

/**
 * ONE FINISHED DOCUMENT. Pure: it invents nothing and reads nothing.
 *
 * `availableSeasons` is derived from `seasons` rather than passed beside it, so the list of seasons
 * the screen offers and the list it actually holds numbers for cannot disagree — a body that offered
 * a season with no chart behind it was one of the failure modes this design set out to remove.
 */
export function buildPeekDocument(input: PeekDocumentInput): PeekDocument {
  const seasons: readonly PeekDocumentSeason[] = input.seasons.map((entry) => ({
    season: entry.season,
    weeks: entry.stats.weeks,
    pointsPerGame: entry.stats.pointsPerGame,
    pointsPerGamePercentile: entry.stats.pointsPerGamePercentile,
    log: entry.stats.log,
    totals: entry.stats.totals,
    kdefSeason: entry.stats.kdefSeason ?? null,
  }));
  return {
    player: input.player,
    availableSeasons: seasons.map((season) => season.season),
    isRookie: input.isRookie,
    positionRank: input.positionRank,
    adpPercentile: input.adpPercentile,
    expertRank: input.expertRank,
    modelRank: input.modelRank,
    injuryDesignation: input.injuryDesignation,
    news: input.news,
    reasons: input.reasons,
    capsule: input.capsule,
    dossier: input.dossier,
    seasons,
    asOf: input.asOf.toISOString(),
    basis: input.basis,
  };
}

/** The three things one league contributes to a document that was built without it. */
export interface PeekDocumentLiveFacts {
  readonly ownedBy: string | null;
  /** The same holder as a person, plus what he is to the reader (`PlayerOwner`). Omitted by a
   *  caller with no reader to compare against, which renders as no ring rather than a guess. */
  readonly owner?: PlayerOwner | null;
  readonly isMockLeague: boolean;
  /** Where this league's draft stands — the one fact the header's verb turns on. Omitted by a
   *  caller that has not read it, which reads as `"predraft"`: never an act we cannot stand
   *  behind, and never a link out of a draft that might be running. */
  readonly draftPhase?: PlayerLeagueDraftPhase;
  /**
   * This league's own regular season length. It caps the CURRENT season's week axis and nothing
   * else: a fourteen-week league never draws a week it does not play. A prior season has no future
   * to cap against and is bounded by the NFL's own finished regular season instead.
   */
  readonly seasonWeeks: number;
  readonly requestedSeason: number | undefined;
}

/**
 * THE DOCUMENT PLUS THE LEAGUE, AS THE SCREEN'S OWN BODY. Pure.
 *
 * `requestedSeason` is honoured only when it names a season the document actually holds; otherwise
 * the newest one answers, which is the current season once the league has played a week and the most
 * recent PRIOR season for as long as it has not.
 */
export function hydratePeekDocument(document: PeekDocument, live: PeekDocumentLiveFacts): PlayerSeasonBody {
  const season =
    live.requestedSeason !== undefined && document.availableSeasons.includes(live.requestedSeason)
      ? live.requestedSeason
      : (document.availableSeasons[0] ?? PRODUCT_SEASON);
  const stored = document.seasons.find((entry) => entry.season === season);
  const stats = capToSchedule(stored, season, live.seasonWeeks);

  return {
    player: document.player,
    availableSeasons: document.availableSeasons,
    season,
    isRookie: document.isRookie,
    positionRank: document.positionRank,
    adpPercentile: document.adpPercentile,
    expertRank: document.expertRank,
    modelRank: document.modelRank,
    pointsPerGame: stats.pointsPerGame,
    pointsPerGamePercentile: stats.pointsPerGamePercentile,
    weeks: stats.weeks,
    ownedBy: live.ownedBy,
    owner: live.owner ?? null,
    isMockLeague: live.isMockLeague,
    draftPhase: live.draftPhase ?? "predraft",
    injuryDesignation: document.injuryDesignation,
    log: stats.log,
    totals: stats.totals,
    kdefSeason: stats.kdefSeason,
    news: document.news,
    reasons: document.reasons,
    // Chip-eligible only — every tribal law plus every CONFIRMED discovered one; see
    // `chipEligibleLaws`' own docblock. Read from the in-memory registry rather than stored, so a
    // newly confirmed law reaches every peek on the next deploy and not on the next rebuild.
    laws: chipEligibleLaws(registry()),
    asOf: document.asOf,
    capsule: document.capsule,
    dossier: document.dossier,
  };
}

/** One season's numbers, as the body renders them. `PeekDocumentSeason` without the year, since
 *  which year it is has already been settled by the time this shape is built. */
type HydratedSeason = Omit<PeekDocumentSeason, "season">;

/** An empty season, for a player the document holds nothing for. Absence, never a zeroed chart. */
const NOTHING_TO_SHOW: HydratedSeason = { weeks: [], pointsPerGame: null, pointsPerGamePercentile: null, log: [], totals: null, kdefSeason: null };

/**
 * THE LEAGUE'S SCHEDULE CAP, applied to the CURRENT season only.
 *
 * WHAT HAPPENS TO THE PERCENTILE WHEN A WEEK IS ACTUALLY DROPPED, and why it is absence. The stored
 * `pointsPerGamePercentile` compares his average over EVERY played week against every peer's average
 * over the same weeks. Trimming his weeks without trimming theirs would compare two different
 * questions and print the answer as if it were one; recomputing it honestly would mean carrying
 * every peer's weekly line inside every player's document, which is tens of megabytes per scoring
 * hash for a comparison that only ever differs in the closing weeks of a short-schedule league's
 * season. So the number itself is recomputed from the weeks that remain and the COMPARISON is
 * dropped, which renders as ordinary ink rather than as a tint taken over the wrong population.
 *
 * The overwhelmingly common case drops nothing at all and this function is the identity.
 */
function capToSchedule(stored: PeekDocumentSeason | undefined, season: number, seasonWeeks: number): HydratedSeason {
  if (stored === undefined) return NOTHING_TO_SHOW;
  if (season !== PRODUCT_SEASON) return stored;

  const weeks: readonly PlayerWeekView[] = stored.weeks.filter((week) => week.week <= seasonWeeks);
  if (weeks.length === stored.weeks.length) return stored;

  const log: readonly PlayerGameLogRow[] = stored.log.filter((row) => row.week <= seasonWeeks);
  return {
    weeks,
    pointsPerGame: pointsPerGameOf(weeks),
    pointsPerGamePercentile: null,
    log,
    totals: totalsFromLog(log),
    kdefSeason: stored.kdefSeason,
  };
}
