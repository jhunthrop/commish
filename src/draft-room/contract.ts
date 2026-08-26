import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";

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
 *  once `phase === "complete"` — a live or scheduled mock never renders `MockResults` at all. */
export interface MockResultsCopy {
  readonly heading: string;
  readonly retentionSentence: string;
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
}

export interface DraftQueueBody {
  readonly queue: readonly string[];
}
