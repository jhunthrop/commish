import type { DraftStatus } from "@/domain/draft";
import type { DraftFormat, TeamCard } from "@/domain/league";
import type { Position } from "@/domain/player";
import type { RosterSlotConfig, RosterSlotType } from "@/domain/roster";
import type { TradeFlag, TradeVerdict } from "@/ai-advisor/valuation";
import type { FirstRunPlan } from "@/identity";
import type { LeagueTerms, NextAction, StandingsRow, WeekStatus } from "@/league";

/**
 * TYPES ONLY, no runtime code. Imported by the `/api/leagues/**` routes as their return shape
 * and by the client components as their prop shape, so the two cannot drift.
 */
export interface LeagueSummary {
  readonly id: string;
  readonly name: string;
  readonly format: DraftFormat;
  readonly teamCount: number;
  readonly filledTeams: number;
  readonly isCommissioner: boolean;
  readonly myTeamId: string | null;
  readonly draftId: string | null;
  readonly draftStatus: DraftStatus | null;
}

export interface LeagueListBody {
  readonly leagues: readonly LeagueSummary[];
}

export interface CreateLeagueBody {
  readonly leagueId: string;
  readonly teamId: string;
  readonly draftId: string;
}

export interface InviteBody {
  readonly code: string;
  /** An absolute PATH, not a full URL — the browser already knows its own origin. */
  readonly path: string;
  readonly expiresAt: string;
  readonly maxUses: number;
}

export interface JoinBody {
  readonly leagueId: string;
  readonly teamId: string;
  readonly alreadyMember: boolean;
}

/**
 * `GET /api/invites/[code]`'s success payload — one `LeagueTerms` (`@/league/terms`), the exact
 * shape `LeagueTermsPanel` renders here on the invite page AND, unchanged, inside the league
 * itself (Task 8). Re-exported under its own name rather than left as a bare `LeagueTerms`
 * import at call sites, so this contract's own docblock convention (every route's wire shape
 * has a name ending in `Body`) holds for this route too.
 */
export type InvitePreviewBody = LeagueTerms;

/** One row of the standings table, ready to render: the pure math plus what the page shows. */
export interface TeamStandingsRow extends StandingsRow {
  readonly teamName: string;
  /** Can no longer be caught for a playoff spot. Computed server-side, never in React. */
  readonly clinched: boolean;
  readonly ownerDisplayName: string;
  /** The owner's STORED avatar ref, not a URL — same contract as `TeamCard.ownerAvatarUrl`. */
  readonly ownerAvatar: string | null;
}

/**
 * One league member as the members panel (`LeagueMembersPanel`) renders it: `TeamCard` plus
 * the one raw fact needed to find the commissioner among peers. `ownerUserId` is never shown —
 * it is only ever compared against `LeagueHomeBody.commissionerUserId` to mark the single row
 * that runs the league. That comparison, and the display name and face it sits beside, are
 * fair game inside a league by design: the public-browse contract (Task 6) is the one place
 * commissioner identity stays hidden, and this panel is members-only.
 */
export interface LeagueMemberCard extends TeamCard {
  readonly ownerUserId: string;
}

export interface MatchupSummary {
  readonly weekNumber: number;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly homeTeamName: string;
  readonly awayTeamName: string;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  /**
   * True once the settlement write has happened (`finalizeWeek`, `src/stats-pipeline/finalize.ts`)
   * — the two scores above are stamped and will not move again. It does NOT mean the week's games
   * are done; a week can be `in_progress` for hours before this flips. Every "is this live" UI
   * decision reads `weekStatus` instead, never this field.
   */
  readonly final: boolean;
  readonly weekStatus: WeekStatus;
}

/**
 * One league, as the cross-league home renders it: everything `LeagueSummary` already carries,
 * plus the record, this week's matchup, and the one next action — the three things `/app`
 * exists to answer per league (Task 9, Spec Step 8).
 */
export interface HomeLeagueCard extends LeagueSummary {
  /** This user's own win-loss-tie record, from matchups already played. `null` only for the
   *  degenerate case of no team in this league at all — every card the home page actually
   *  renders has one, since it lists leagues by team membership. */
  readonly record: { readonly wins: number; readonly losses: number; readonly ties: number } | null;
  /** The current week, always present — `seasonProgress` never returns undefined even for a
   *  league with no matchups yet, so there is no "no week" state to represent. */
  readonly weekNumber: number;
  readonly weekStatus: WeekStatus;
  /** This user's matchup for `weekNumber`, or `null` on a bye or before the schedule exists. */
  readonly matchup: MatchupSummary | null;
  /** `null` renders as no action at all — never a disabled button (`@/league/next-action.ts`). */
  readonly nextAction: NextAction | null;
}

export interface HomeBody {
  readonly leagues: readonly HomeLeagueCard[];
  /**
   * The zero-leagues fork (`firstRunPlan`, `@/identity`), or `null` once the caller has at
   * least one league. Computed by the ROUTE, not `crossLeagueHome` (`@/league-service/home.ts`):
   * the plan needs the caller's preferences, and the service only ever takes a db and a user id.
   * `HomeBoard` reads this field, not `leagues.length`, to decide which empty treatment to show.
   */
  readonly firstRun: FirstRunPlan | null;
}

export interface LeagueHomeBody {
  readonly leagueId: string;
  readonly name: string;
  readonly format: DraftFormat;
  readonly teamCount: number;
  readonly rosterSlots: readonly RosterSlotConfig[];
  readonly isCommissioner: boolean;
  /** The commissioner's raw user id — never rendered on its own, only handed to
   *  `LeagueMembersPanel` so it can mark the one member who runs the league. */
  readonly commissionerUserId: string;
  readonly myTeamId: string | null;
  readonly teams: readonly LeagueMemberCard[];
  readonly standings: readonly TeamStandingsRow[];
  /**
   * The SAME `LeagueTerms` the invite preview renders (`InvitePreviewBody`, above), assembled by
   * the SAME pure `leagueTerms` — every member sees this, not just the commissioner: the terms
   * are what everybody in the league is playing under, and gating them on `isCommissioner` would
   * make the surface pointless.
   */
  readonly terms: LeagueTerms;
  readonly currentWeek: number;
  readonly totalWeeks: number;
  readonly myMatchup: MatchupSummary | null;
  /** `currentWeek`'s status. Present even when `myMatchup` is null — a bye week is still live. */
  readonly weekStatus: WeekStatus;
  readonly draftId: string | null;
  readonly draftStatus: DraftStatus | null;
}

export interface MatchupLineupEntry {
  readonly slot: RosterSlotType;
  readonly slotIndex: number;
  readonly playerId: string | null;
  readonly playerName: string | null;
  readonly position: Position | null;
  readonly points: number;
}

export interface MatchupSide {
  readonly teamId: string;
  readonly teamName: string;
  readonly score: number | null;
  readonly starters: readonly MatchupLineupEntry[];
  readonly bench: readonly MatchupLineupEntry[];
}

export interface MatchupDetail {
  readonly weekNumber: number;
  readonly home: MatchupSide;
  readonly away: MatchupSide;
  /** True once the settlement write has happened — see `MatchupSummary.final`'s docblock. */
  readonly final: boolean;
  readonly weekStatus: WeekStatus;
}

export interface MatchupWeekBody {
  readonly leagueId: string;
  readonly weekNumber: number;
  readonly totalWeeks: number;
  readonly myTeamId: string | null;
  readonly matchups: readonly MatchupDetail[];
  readonly weekStatus: WeekStatus;
}

export interface LineupSlotView {
  readonly slot: RosterSlotType;
  readonly slotIndex: number;
  readonly playerId: string | null;
  readonly playerName: string | null;
  readonly position: Position | null;
}

export interface LineupBody {
  readonly weekNumber: number;
  /**
   * True once the week has started (`isLineupLocked`, `@/league/week-status.ts`) — not once it
   * has been scored. The editor renders read-only rather than disabled-and-silent.
   */
  readonly locked: boolean;
  readonly starters: readonly LineupSlotView[];
  readonly bench: readonly LineupSlotView[];
}

/** What the start/sit advisor answers with. Advice, never an action. */
export interface AdviceBody {
  readonly headline: string;
  readonly reasoning: string;
  /**
   * True when this came from the app's own deterministic math because the assistant was
   * unavailable. A designed state, not an error — the answer is still complete.
   */
  readonly degraded: boolean;
}

/**
 * What the trade analyzer answers with: the deterministic verdict, plus prose about it.
 *
 * `verdict` and `flags` are the SAME `TradeVerdict`/`TradeFlag` unions `tradeBalance` (the
 * platform's own fairness detector, `@/ai-advisor/valuation`) produces — imported as a type
 * only, so a flag this contract doesn't know about is a compile error here rather than a
 * value that silently widens to `string` on the wire.
 */
export interface TradeAssessmentBody extends AdviceBody {
  readonly verdict: TradeVerdict;
  readonly flags: readonly TradeFlag[];
  readonly givingValue: number;
  readonly receivingValue: number;
}
