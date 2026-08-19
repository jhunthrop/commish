import type { DraftStatus } from "@/domain/draft";
import type { DraftFormat, TeamCard } from "@/domain/league";
import type { Position } from "@/domain/player";
import type { RosterSlotConfig, RosterSlotType } from "@/domain/roster";
import type { TradeFlag, TradeVerdict } from "@/ai-advisor/valuation";
import type { StandingsRow } from "@/league";

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

/** One row of the standings table, ready to render: the pure math plus what the page shows. */
export interface TeamStandingsRow extends StandingsRow {
  readonly teamName: string;
  /** Can no longer be caught for a playoff spot. Computed server-side, never in React. */
  readonly clinched: boolean;
}

export interface MatchupSummary {
  readonly weekNumber: number;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly homeTeamName: string;
  readonly awayTeamName: string;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  /** True once both scores exist. The UI never infers "final" from a null check of its own. */
  readonly final: boolean;
}

export interface LeagueHomeBody {
  readonly leagueId: string;
  readonly name: string;
  readonly format: DraftFormat;
  readonly teamCount: number;
  readonly rosterSlots: readonly RosterSlotConfig[];
  readonly isCommissioner: boolean;
  readonly myTeamId: string | null;
  readonly teams: readonly TeamCard[];
  readonly standings: readonly TeamStandingsRow[];
  readonly currentWeek: number;
  readonly totalWeeks: number;
  readonly myMatchup: MatchupSummary | null;
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
  readonly final: boolean;
}

export interface MatchupWeekBody {
  readonly leagueId: string;
  readonly weekNumber: number;
  readonly totalWeeks: number;
  readonly myTeamId: string | null;
  readonly matchups: readonly MatchupDetail[];
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
  /** True once the week has been scored. The editor renders read-only rather than disabled-and-silent. */
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
