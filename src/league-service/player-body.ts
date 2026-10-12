// WHAT THE PLAYER SCREEN DRAWS — the one body the peek's bottom sheet and the full player page
// both render. Its own module since the peek document round (2026-09-07): the document writer
// builds this shape offline and `playerSeason` hydrates it, so the type cannot live inside the
// reader that returns it without the two importing each other in a circle.
import type { Player } from "@research/domain/player";
import type { PlayerCapsuleView } from "@research/capsules/store";
import type { KdefSeasonLine } from "@research/projections/kdef/season-lines";
import type { Law } from "@research/projections/laws/types";
import type { BoardReason } from "@research/projections/preseason/board";
import type { PlayerDossierFacts } from "./dossier-facts";
import type { PlayerGameLogRow, PlayerSeasonTotals, PlayerWeekView } from "./player-season-stats";

/**
 * Everything the player screen draws, and NOTHING WE CANNOT REACH.
 *
 * The screen's source strip compares three independent readings of one quantity — where the
 * market has him, where the experts have him, where OUR MODEL has him. All three are computed by
 * the peek document writer, and each is `null` for a player it genuinely cannot be computed for.
 * What each one costs:
 *
 * - **The market** is `players.adp`, already on the row.
 * - **Expert consensus** is `preseason_rankings`, source `fantasypros_ecr_ppr`, read through
 *   `player_crosswalk`. It resolves for a player the crosswalk placed AND the publisher ranked.
 * - **Our own board** is `preseason_projections`, source `BOARD_SOURCE` (`board-store.ts` — the
 *   market-blended board), read through the same crosswalk. A live-taken row for the current season
 *   is UNMEASURED, not merely unfilled: `preseason/scorecard.ts`'s `assertGradableMoment` refuses to
 *   grade a `momentKind: "live"` board against anything, structurally, because the season it
 *   projects has not been played yet. `modelRank` for the current season is exactly as real as the
 *   market's and the experts' own ranks beside it, and carries no accuracy claim neither of those
 *   two ever carried either.
 *
 * ALL THREE ARE READ AT the document's own `asOf`, through the same `as_of <=` gate the backtest
 * uses. A product surface lives in the present, which is what lets one store serve the harness and
 * the product without either holding a special case for the other.
 *
 * SEASON SELECTION (2026-09-04 widening, founder: "make sure our player cards show prior year data
 * when the season hasn't started"). `player_stat_lines`/`stat_weeks` are single-season — the CURRENT
 * season only — and are empty until the league's own weeks start reporting results, which for a
 * fresh season can be months. `availableSeasons`, `season` and `isRookie` make this body ANSWER FOR
 * ONE SEASON, chosen honestly rather than left to draw an empty current season:
 *
 * - `availableSeasons` lists every season this body could have answered for, newest first. The
 *   current season is in it only once the league has actually played a week — the same
 *   `stat_weeks.status != 'scheduled'` gate the chart itself already enforced, so a preseason card
 *   never claims a current season it has zero rows for. A prior season is in it only when THIS
 *   PLAYER has at least one recorded week for it in the projection engine's point-in-time store
 *   (`player_week_observations`, read through the crosswalk), or, for a kicker and a team defense,
 *   in the archive that holds them.
 * - `season` is which one of those the rest of this body (`weeks`, `log`, `totals`, `pointsPerGame`,
 *   `pointsPerGamePercentile`) actually describes: the caller's request when it named an available
 *   one, otherwise the newest available season. That fallback is the whole point: a card opened in
 *   August, before this year's first snap, shows last year's real season instead of thirteen empty
 *   columns.
 * - A PRIOR season's `weeks`/`log`/`totals` are scored under THIS league's own rules, never borrowed
 *   or interpolated. `carries`/`targets` are `null` on a prior season's game log rows: see
 *   `PlayerGameLogRow`'s own docblock for why the store cannot honestly fill them.
 * - `isRookie` and `availableSeasons` TOGETHER carry a THREE-STATE fact, and a caller must read
 *   both rather than inferring one from the other:
 *     1. `availableSeasons.length > 0` — normal: chart whichever season `season` names.
 *     2. `availableSeasons.length === 0 && isRookie` — a CONFIRMED rookie (`nfl_players
 *        .rookie_season === PRODUCT_SEASON`, read through the crosswalk — the one authoritative
 *        "which season did this man enter the league" fact this product carries). Nothing to chart
 *        because nothing has happened yet, not because nothing is known. The UI prints "his first
 *        NFL season" here and nowhere else.
 *     3. `availableSeasons.length === 0 && !isRookie` — a THIRD state: not a rookie (or a rookie
 *        status this product cannot confirm, which is the SAME honest position as not being one),
 *        and no prior season on record either. The UI must print a sentence that claims only what
 *        is known — "no prior seasons on record" — never the rookie sentence.
 *
 * `positionRank`, `adpPercentile`, `expertRank`, `modelRank`, `reasons` and `laws` are NOT
 * season-selected: they are this year's draft outlook, which is a fact about the season a manager is
 * drafting for, not about whichever season's game log he happens to be looking at.
 */
/**
 * WHAT THE MANAGER WHO HOLDS HIM IS TO THE MANAGER READING THE SCREEN (P6: your rival is always in
 * the frame). `"you"` wears the amber ring, `"rival"` the rose one, `"other"` no ring at all.
 *
 * `"rival"` means one thing exactly: he is held by the team the reader plays THIS WEEK, in this
 * league. It is never a standing grudge, never a division, never a record — those would each be a
 * different claim and the screen states this one.
 */
/** Where the league this body was read under stands in its own draft — see `draftPhase`. */
export type PlayerLeagueDraftPhase = "predraft" | "live" | "complete";

export type PlayerOwnerRelation = "you" | "rival" | "other";

/**
 * WHO HAS HIM, AS A PERSON (P1: the person comes before the number; Sideline: "manager avatars
 * everywhere, always beside their name"). `ownedBy` beside this carries the same team's NAME and
 * stays, because the peek's identity line and every existing consumer say "On Iron Owls" and a team
 * name is the right half of that sentence; this adds the half a face needs.
 */
export interface PlayerOwner {
  readonly teamId: string;
  readonly teamName: string;
  readonly managerName: string;
  /** The stored avatar ref, as `Avatar` takes it, or `null` for a manager who has set none. */
  readonly managerAvatar: string | null;
  readonly relation: PlayerOwnerRelation;
}

export interface PlayerSeasonBody {
  readonly player: Player;
  /** Every season this body could answer for, newest first. Can be empty for a reason `isRookie`
   *  does NOT settle on its own — see this interface's own docblock's three-state account. */
  readonly availableSeasons: readonly number[];
  /** Which season `weeks`/`log`/`totals`/`pointsPerGame`/`pointsPerGamePercentile` describe. */
  readonly season: number;
  /** A CONFIRMED rookie fact (`nfl_players.rookie_season`), never inferred from `availableSeasons`
   *  being empty — a crosswalk miss or an unrecorded veteran also has an empty `availableSeasons`
   *  and is NOT this. Read `isRookie` and `availableSeasons` together. */
  readonly isRookie: boolean;
  /** His rank among players at his position by market draft position, or `null` where the ADP
   *  feed does not carry him. */
  readonly positionRank: number | null;
  /** Where his draft position sits among every ranked player, 0..1, best is 1. `null` when he is
   *  unranked, or when the feed ranks nobody else to compare him against. */
  readonly adpPercentile: number | null;
  /**
   * Expert consensus rank for this season, or `null` where the crosswalk could not place him or
   * the publisher does not rank him. Never approximated from a neighbouring season: a consensus is
   * a claim about one August and it stops being one the moment it is borrowed.
   */
  readonly expertRank: number | null;
  /** Our own board's overall rank for this season, or `null` where there is no board for him. */
  readonly modelRank: number | null;
  /** Points per game over the weeks he actually played in `season`, under THIS league's scoring
   *  rules. */
  readonly pointsPerGame: number | null;
  readonly pointsPerGamePercentile: number | null;
  /** Every week of `season` that has actually been played, in order — every league week for the
   *  current season, every NFL regular-season week for a prior one. */
  readonly weeks: readonly PlayerWeekView[];
  /** Which of THIS league's teams holds him, or `null` for a free agent here. Joined LIVE on every
   *  read (peek document design §3.4): a roster move changes no document. */
  readonly ownedBy: string | null;
  /**
   * The SAME holder `ownedBy` names, as a person, plus what that person is to the reader (P1, P6).
   * `null` for a free agent here, and `undefined` on the many hand-built fixtures that predate the
   * Sideline research round — the same "optional so fixtures need not all learn at once" rule
   * `capsule` and `dossier` keep. A caller reads `owner ?? null`, never `owner!`.
   *
   * The RELATION needs a reader, so it is `"other"` for every read made without one (the peek's own
   * API route and the page both pass the signed-in manager; a background rebuild does not). Absence
   * of a ring is the honest render of "we were not asked whose screen this is".
   */
  readonly owner?: PlayerOwner | null;
  /**
   * `leagues.isMock` for THIS league — `true` for a mock draft's own practice room. A roster-status
   * claim built from `ownedBy` ("Free agent in this league" / "On {team}") is a fact about a REAL
   * room; a mock room's teams are the founder-required seeded bot roster, and telling a manager
   * practicing a mock that a player is "a free agent in this league" describes a room that does not
   * exist the way a real league does. Consumers gate that one line on this flag.
   */
  readonly isMockLeague: boolean;
  /**
   * WHERE THIS LEAGUE'S DRAFT IS, because the one thing a manager can do about a player depends on
   * it and nothing else in this body says so. Three states, not a boolean (fix round 2, H1): the
   * middle one is the whole point.
   *
   * - `"predraft"` — `drafts.status` is `'scheduled'`, `'dissolved'`, or there is no draft row at
   *   all. EVERY player is un-held here, so "Add him" is an act this manager cannot make.
   * - `"live"` — `'in_progress'`. The room is running, it has its own Draft verb, and any other
   *   solid pill inside it is a link OUT of a draft a manager is in the middle of.
   * - `"complete"` — the season's own states apply: free agent, yours, or somebody else's.
   *
   * Optional on the type, the rule `capsule`, `dossier` and `owner` keep: a hand-built fixture need
   * not learn about it, and `undefined` reads as `"predraft"`, which offers no act we cannot stand
   * behind.
   */
  readonly draftPhase?: PlayerLeagueDraftPhase;
  /** His current designation from the harvested injuries feed ("Q", "O", "IR"), or `null` when
   *  the feed does not name him — absence means healthy as far as the source says. */
  readonly injuryDesignation: string | null;
  /** Raw production per played week, newest first — the ESPN-depth game log. Empty for a kicker
   *  and a team defense, whose season is told by `kdefSeason` instead: every column in this log is
   *  an offensive one, and a row of nine zeros beside a kicker's name is a worse answer than none. */
  readonly log: readonly PlayerGameLogRow[];
  readonly totals: PlayerSeasonTotals | null;
  /**
   * A KICKER'S OR A TEAM DEFENSE'S OWN SEASON, scored under this league's rules for whichever
   * `season` this body answers for. `null` for every other position, and for a kicker or team
   * defense the archive holds no week of that season for.
   *
   * IT IS A MEASUREMENT AND NOT A PROJECTION. Neither position ships one (`KDEF_DECISION`). It is
   * the answer to "what did he do", which is the question the archive can answer.
   */
  readonly kdefSeason: KdefSeasonLine | null;
  /** Recent headlines that name him, newest first, from the harvested news feed. */
  readonly news: readonly { readonly title: string; readonly link: string }[];
  /**
   * Every reason the CURRENT season's board stored for him — the Outlook section's full chain,
   * never truncated to a compact row's top two the way the draft board's sticker is. Empty for a
   * player the crosswalk could not place or the board never ranked, the same "absence means nothing
   * to say" rule `boardReasons` itself keeps.
   */
  readonly reasons: readonly BoardReason[];
  /** The law registry, for `ReasonChip`'s own claim lookup on a `"law"` reason. */
  readonly laws: readonly Law[];
  /**
   * WHEN THIS BODY'S FACTS WERE KNOWABLE (peek document design §3.6, 2026-09-07) — the stored
   * document's own `as_of`, as an ISO instant, surfaced so the screen can say what it is looking at
   * rather than implying everything on it is live. The two league facts beside it (`ownedBy`,
   * `isMockLeague`) are joined at read time and are therefore newer than this stamp by construction.
   *
   * Optional on the type for the reason `capsule` and `dossier` are (see their own docblocks): the
   * many existing fixtures that build a body by hand need not all learn about the stamp at once.
   * Every real read through `playerSeason` sets it.
   */
  readonly asOf?: string;
  /**
   * The auto-written capsule — LLM voice over verified facts, the SAME facts the sweep job computes
   * off the board (`src/capsules/collect.ts`), mechanically validated before it is ever stored.
   * `null` for a player the sweep has not reached yet (a board-irrelevant player, or one not swept),
   * never a placeholder string standing in for absence. Optional on the type (rather than
   * always-present) so the many existing fixtures that build a `PlayerSeasonBody` by hand need not
   * all learn about capsules at once; every real read through `playerSeason` sets it.
   */
  readonly capsule?: PlayerCapsuleView | null;
  /**
   * The same fact sheet the capsule sweep computes, reshaped for the client
   * (`league-service/dossier-facts.ts`'s `dossierFactsFrom`). Unlike `capsule` (LLM prose over these
   * same facts), this is the raw, structured numbers themselves: market, projection (with the
   * per-game rate and its position rank added), availability, usage, trend, books, last season's
   * story, injury and a news count, plus which scoring format they were computed under.
   *
   * IT IS READ, NOT COMPUTED (peek-facts round, 2026-09-07). `playerSeason` used to build it at
   * request time through `dossierFactsFor`, which cost 43 queries and most of the peek's wall clock.
   * The nightly capsule sweep and the post-finalize `season-week` step store it, and it now rides
   * inside the peek document itself.
   *
   * `null` MEANS THE ROW IS NOT THERE, which happens for two honest reasons and neither is a
   * placeholder: the board never ranked him (a kicker, a team defense, an unranked name), or the
   * precompute has not reached him yet (a new signing, or a fresh deploy before the first sweep).
   * The screen renders absence in both cases, never a stale or guessed dossier.
   */
  readonly dossier?: PlayerDossierFacts | null;
}
