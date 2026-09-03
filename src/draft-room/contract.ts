import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import type { Law } from "@/projections/laws/types";
import type { BoardReason } from "@/projections/preseason/board";
import type { PickFactCopy } from "./state/format";

/**
 * The two response bodies the draft room reads. Declared once, imported by the route
 * handlers as their return shape and by the client hook as its parse target, so the two
 * sides of the wire cannot drift. Types only — this module emits no runtime code.
 */
/**
 * The `link`-mode waiting surface's own data (Task 8, Step 3) — present on `DraftSnapshotBody.
 * mock.share` only for an unstarted `link`-mode room. `ShareLinkPanel`'s whole scope: a `lobby`
 * or `solo` room, or a started draft, never carries this at all.
 */
export interface MockShareInfo {
  readonly shareCode: string;
  /** An absolute PATH, not a full URL — the browser already knows its own origin, the same
   *  convention `InviteBody.path` (`@/league-room/contract`) already keeps for a real league's
   *  own invite link. */
  readonly path: string;
  readonly teamCount: number;
  readonly seatsFilled: number;
  /** ISO instant the fill window fires — `ShareLinkPanel`'s own countdown target. */
  readonly startsAt: string;
}

/** `MockResults`' own copy (Task 8, Step 2), present on `DraftSnapshotBody.mock.results` only
 *  once `phase === "complete"` — a live or scheduled mock never renders `MockResults` at all.
 *  `rosterHeading`/`picksHeading`/`openSlotLabel`/`noPicksMessage`/`pickFact` are the mock-results
 *  design review's own finding (E6, 2026-08-26): the surface's remaining bare literals, moved
 *  beside their siblings here rather than hardcoded in the client component or `state/format.ts`. */
export interface MockResultsCopy {
  readonly heading: string;
  readonly retentionSentence: string;
  readonly rosterHeading: string;
  readonly picksHeading: string;
  readonly openSlotLabel: string;
  readonly noPicksMessage: string;
  readonly pickFact: PickFactCopy;
  readonly runAgainLabel: string;
  readonly openLobbyLabel: string;
  readonly browseLeaguesLabel: string;
}

/**
 * Everything a mock room's OWN chrome needs to say, carried over the wire from the route that
 * already knows `MOCK_COPY` (Task 8) — the client boundary
 * (`eslint.config.mjs`'s `SERVER_ONLY_MODULE_GROUPS`) blocks every `src/draft-room/**` file from
 * value-importing `@/mock-draft` itself, so this is how its words reach `PracticeBanner`,
 * `DraftBoard`'s bot marker and `MockResults` — pre-rendered data, the identical `NoticeView`/
 * `ActivityRow` shape `@/integrity` already uses for the same reason. `null` for a real league,
 * for every field this route ever answers.
 */
export interface MockRoomInfo {
  /** `MOCK_COPY.practiceBanner`, verbatim. */
  readonly practiceBanner: string;
  /** `MOCK_COPY.botMarkerLabel` — the accessible label a bot's seat carries. */
  readonly botMarkerLabel: string;
  /** `MOCK_COPY.botBadge` — the visible short badge text. */
  readonly botBadge: string;
  /**
   * Task 10, finding 1: the expected seconds a practice opponent's turn actually takes
   * (`expectedBotThinkDelaySeconds`, the delay draw's own midpoint for this room's clock) — the
   * dock's wait estimate prices bot seats with this instead of the full pick clock, which
   * overstated a mock's wait roughly tenfold. A number, not the delay bounds: the bot's
   * playbook (`MOCK_CONFIG.strategy`) stays server-only.
   */
  readonly expectedBotPickSeconds: number;
  /** Present only for an unstarted `link`-mode room. */
  readonly share: MockShareInfo | null;
  /** Present only once the draft has actually finished. */
  readonly results: MockResultsCopy | null;
}

/**
 * The scheduled room's waiting story (R2, the draft-room design review carried into this lane):
 * present only while `draft.phase === "scheduled"`, null the moment the draft leaves it. The
 * rail renders `detail` in place of the commissioner sentence it used to hardcode — false for
 * every house, auto-start and mock room — and counts down to `kickoffAt` when one exists.
 */
export interface WaitingInfo {
  /**
   * The ISO instant the rail counts down to — the draft's own `kickoff_at` for a `scheduled`
   * trigger, the fill window's `mock_rooms.starts_at` for a practice room, and null for a
   * `when_full` room, whose only honest answer is the sentence (there is no chosen time).
   */
  readonly kickoffAt: string | null;
  /**
   * The trigger-aware sentence: quoted verbatim from `describeStartTiming`
   * (`@/matchmaking/roll`, the one start-timing authority) for a real league, or
   * `MOCK_COPY.waitingDetail` for a practice room — composed by the snapshot route, never by
   * the client, for the same boundary reason as `MockRoomInfo` above.
   */
  readonly detail: string;
}

export interface DraftSnapshotBody {
  readonly draft: DraftStateView;
  /** The league's display name — what `RoomRail` puts at the top of the room. */
  readonly leagueName: string;
  /** The caller's own team, or null for a commissioner without one. */
  readonly teamId: string | null;
  readonly isCommissioner: boolean;
  readonly teams: readonly TeamCard[];
  /** The caller's OWN autopick queue. Never anybody else's — a queue is a private draft plan. */
  readonly queue: readonly string[];
  /** Null for a real league. See `MockRoomInfo`'s own docblock for why this crosses the wire as
   *  data rather than the client ever importing `@/mock-draft` itself. */
  readonly mock: MockRoomInfo | null;
  /** The scheduled room's waiting story (R2) — null once the draft has left `scheduled`. */
  readonly waiting: WaitingInfo | null;
}

export interface DraftPlayersBody {
  readonly players: readonly Player[];
  /**
   * Task 8: the board's own law-backed reasons for the players this room can see, keyed by
   * `Player.id` — a plain `Record`, not a `Map`, since a `Map` does not survive `JSON.stringify`;
   * `useDraftRoom` rebuilds it into a `Map` on receipt. A player absent from this object is a
   * player `boardReasons` has nothing for (never ranked, or ranked with no confirmed law true for
   * him) — the same "absence means nothing to say" rule `boardReasons` itself keeps.
   *
   * Optional rather than required: the real route (`GET /api/drafts/[draftId]/players`) always
   * sets it, but this type is also the shape hand-built test fixtures across the room construct,
   * and those suites are on the deferred UX ledger rather than reopened for this task. `undefined`
   * reads exactly like an empty object everywhere this is consumed.
   */
  readonly reasons?: Readonly<Record<string, readonly BoardReason[]>>;
  /** The law registry (`registry()`, read server-side), for `ReasonChip`'s own claim lookup.
   *  Optional for the same reason `reasons` is. */
  readonly laws?: readonly Law[];
  /**
   * NFL team code → that team's bye week, from `byeWeeksByTeam` (`@/league-service/nfl-schedule`,
   * the Quilt's BYES tab and lens, 2026-09-02) — a fact the real ingested schedule states, never
   * an invention. A team absent from this record has no claimable bye (schedule not ingested, or
   * incomplete), and every bye surface renders nothing for it. Optional for the same
   * fixture-compatibility reason `reasons` is; `undefined` reads as an empty record everywhere.
   */
  readonly byeWeeks?: Readonly<Record<string, number>>;
}

export interface DraftQueueBody {
  readonly queue: readonly string[];
}

/**
 * One real season a player actually played, summarized for the peek card's LAST THREE SEASONS
 * table (design ruling, 2026-09-02: the dense card comes back, from the real stat stores).
 * Every number is derived from stored `player_week_observations` weeks — a season with no
 * stored weeks produces NO row here, never a placeholder.
 */
export interface PlayerSeasonSummary {
  readonly season: number;
  readonly gamesPlayed: number;
  /** Fantasy points per game under THIS league's own scoring rules, 1dp. */
  readonly pointsPerGame: number;
  /** Passing + rushing + receiving yards, whole. */
  readonly totalYards: number;
  /** Passing + rushing + receiving touchdowns, whole. */
  readonly totalTouchdowns: number;
  /** "RB3": rank among every player at his position with a stored week that season, by season
   *  fantasy points under the same rules. */
  readonly positionFinish: string;
}

/** One week's fantasy points, for the consistency strip. */
export interface PlayerWeekPoints {
  readonly week: number;
  readonly points: number;
}

/**
 * `GET /api/drafts/[draftId]/players/[playerId]/history` — fetched lazily when the peek opens,
 * cached client-side per player for the room's lifetime, and deliberately NOT widened onto the
 * players payload (it is per-player, historical, and most players are never peeked).
 * `seasons` is latest first, capped at three; `latestWeekly` is the most recent listed season's
 * weeks ascending, `latestWeeklySeason` naming which. A player the stores know nothing about
 * (a rookie, an unplaced crosswalk) answers with both empty — absence, never invention.
 */
export interface PlayerHistoryBody {
  readonly seasons: readonly PlayerSeasonSummary[];
  readonly latestWeeklySeason: number | null;
  readonly latestWeekly: readonly PlayerWeekPoints[];
}
