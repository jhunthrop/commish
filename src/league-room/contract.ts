import type { DraftStatus } from "@/domain/draft";
import type { DraftFormat, TeamCard } from "@/domain/league";
import type { Position } from "@/domain/player";
import type { RosterSlotConfig, RosterSlotType } from "@/domain/roster";
import type { TradeFlag, TradeVerdict } from "@/trades/fairness";
import type { FirstRunPlan } from "@/identity";
import type { LeagueTerms, MedianResult, NextAction, StandingsRow, WeekStatus } from "@/league";

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

/**
 * What `GET /api/leagues/[leagueId]/draft-schedule` and `PUT`'s success response both answer —
 * and, unchanged, the shape `LeagueHomeBody.draftSchedule` carries below, since it is the SAME
 * fact read the SAME way whether the caller is the initial page render or a later PUT. Fix round
 * 1 (review MEDIUM): `DraftSchedulePanel` used to fetch this itself on mount, the wrong sibling
 * pattern for a component living inside a server-rendered parent that already has the row —
 * `AdvisorPanel`/`LineupEditor`/`TradeInboxLink` all take their initial read as a prop from
 * `LeagueHomeBody` and reach `fetchJson` only for a write, and this now matches them: `leagueHome`
 * (`@/league-service/read.ts`) already selects `drafts.status`/`drafts.kickoffAt` and the whole
 * `leagues` row (so `isPublicMatchmade` is already in hand) for its own internal use, at zero
 * extra query cost. The PUT route still calls `draftScheduleView` to build its own response —
 * that write path has no server-rendered parent to hand it a prop.
 */
/**
 * Task 6 (Phase 3.5): NFFC's Kentucky Derby System. The caller's OWN slot ranking and its
 * result, never anybody else's — Plan A's notice-privacy reasoning applies to a ranking whole,
 * because it is a preference a person expressed privately (`slotPreference.ts`'s own docblock).
 */
export interface SlotPreferenceView {
  /** How many draft slots this league has — the league's own `teamCount`, the ceiling every
   *  ranked slot number must fall within. */
  readonly slotCount: number;
  /** 1-based slot numbers, most-wanted first. Empty means "I do not mind" — a real answer, not
   *  an unset one. */
  readonly ranking: readonly number[];
  /** The slot this manager actually drafted from, once the draw has run. `null` before the
   *  draft starts — there is nothing to report yet. */
  readonly assignedSlot: number | null;
  /** True only while the draft is still `scheduled` — the preference window closes at the
   *  draw, on both start doors (a commissioner's press and the platform's own auto-start). */
  readonly canEdit: boolean;
}

export interface DraftScheduleBody {
  readonly draftId: string;
  readonly leagueId: string;
  readonly status: DraftStatus;
  /** ISO instant. For a `'when_full'` draft that hasn't filled yet, this is a PLACEHOLDER
   *  (`createLeague`'s own default) rather than a chosen time — `startTrigger` is what a reader
   *  checks before ever displaying it as a scheduled kickoff (`WaitingRoom`'s own reasoning). */
  readonly kickoffAt: string;
  /** Whether the platform will start this draft on its own if nobody presses the button
   *  (Task 7) — read by the panel to decide whether to say so. */
  readonly isPublicMatchmade: boolean;
  /**
   * Phase 3.5, Task 8: which of the two ways this draft's `kickoffAt` comes to be set — the
   * SAME union `setDraftKickoff`'s own refusal already keys on (`KICKOFF_REFUSALS.whenFull`).
   * `LeagueHome` reads this to decide which of `WaitingRoom`/`DraftSchedulePanel` renders: the
   * two never render at once.
   */
  readonly startTrigger: "scheduled" | "when_full";
  /** How many seats are taken right now — the same `count(teams.id)` `filledTeams` means
   *  everywhere else in this codebase (`LeagueSummary`, `PublicLeagueSummary`). `WaitingRoom`'s
   *  own fill line reads this; `DraftSchedulePanel` (the `'scheduled'`-trigger case) has no use
   *  for it and does not render it. */
  readonly filledTeams: number;
  /** `null` only for a caller with no team in this league (a commissioner without one of
   *  their own) — a ranking is scoped to a team, so there is nothing to show them. */
  readonly slotPreference: SlotPreferenceView | null;
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
   * Whether this league plays a median game (Task 2) — the same `leagues.median_game` flag
   * `standings` above already folded into every row's record. `StandingsTable` reads this,
   * never the rows themselves, to decide whether the record it renders is a two-games-a-week
   * one: the fold is invisible from a `TeamStandingsRow` alone (it is one `wins`/`losses`/`ties`
   * tally either way), so the page needs the flag stated, not inferred.
   */
  readonly medianGame: boolean;
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
  /**
   * `DraftSchedulePanel`'s entire initial read, as a prop — `null` only in the same never-true
   * case `draftId`/`draftStatus` above are already null for (a league somehow missing the draft
   * `createLeague` always writes in the same transaction). Fix round 1: this is what makes the
   * panel a props-in, fetchJson-for-writes-only component like its siblings, rather than a
   * `useEffect` GET on mount.
   */
  readonly draftSchedule: DraftScheduleBody | null;
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

/**
 * One week's league median, as `matchupWeek` (`@/league-service/read.ts`) computes it for a
 * single matchup: the median score itself, plus each side's own result against it
 * (`medianResultFor`, `@/league/median`) — the SAME three-way split (win/loss/tie) the
 * head-to-head score already gets, just against the league's middle score instead of an
 * opponent.
 */
export interface MatchupMedian {
  readonly score: number;
  readonly homeResult: MedianResult;
  readonly awayResult: MedianResult;
}

export interface MatchupDetail {
  readonly weekNumber: number;
  readonly home: MatchupSide;
  readonly away: MatchupSide;
  /** True once the settlement write has happened — see `MatchupSummary.final`'s docblock. */
  readonly final: boolean;
  readonly weekStatus: WeekStatus;
  /**
   * `null` for a non-median league (the toggle is off), and `null` for a median league whose
   * week hasn't settled yet — the same "no median yet" state a week with no scores reads as.
   * Read from `weeks.median_score` (Task 2), never recomputed here: `finalizeWeekInTx` already
   * derived it once, in the transaction that scored these same matchups.
   */
  readonly median: MatchupMedian | null;
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

/**
 * One player as `TradeComposer`/`TradeCard` (Task 8) render it: enough for a `Sticker` plus a
 * `PositionBadge`, nothing more. Built from the SAME roster read `MatchupWeekPage` already makes
 * (`matchupWeek`'s starters + bench) rather than a new roster route — the trade surface needs no
 * more of a roster than the matchup page already assembles, and a second query for the same rows
 * would drift the moment one of them adds a bench slot the other forgets.
 */
export interface TradeRosterPlayer {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
}

/** One team a manager could open a trade with: enough to fill the composer's counterparty `Select`. */
export interface TradeCounterpartyOption {
  readonly teamId: string;
  readonly teamName: string;
}

/**
 * Everything the trade room needs beyond `TradesPageBody` (`@/trades/contract`), assembled once,
 * server side, on `/app/leagues/[leagueId]/trades`: the week a proposal is valued at, the
 * caller's own team, every leaguemate to trade with, and a roster for every team in the league
 * keyed by id. `rostersByTeamId` resolves a stored trade's bare `TradeAsset` ids back to a name
 * and a position for `TradeCard`, in addition to feeding `TradeComposer`'s own player pickers —
 * one read, two consumers, rather than a second fetch for display that the picker already paid
 * for.
 */
/**
 * `GET /api/leagues/[leagueId]/moderation`'s whole response — Plan B's Task 6 persona-panel MEDIUM
 * ("league-commissioner moderation visibility"), landed here (Task 8) as the narrow window the
 * brief specifies: counts and a date, never who, what, or why. `leagueModerationSummary`
 * (`@/integrity-service/flags`) is the one function that builds it, and it answers `null` — never
 * this shape with zeros baked in — for anyone but the league's own commissioner, so a route
 * mapping `null` to 404 never has to branch on WHY the read came back empty.
 */
export interface ModerationSummaryView {
  /** Chat messages in this league the platform removed. Never who wrote them. */
  readonly removedMessages: number;
  /** Reviews the platform removed, written by someone who has (or had) a team in this league.
   *  Reviews are platform-scoped, not league-scoped — see that function's own docblock for how
   *  "in their league" is read for a table with no `league_id` column. */
  readonly removedReviews: number;
  /** The later of the two counts' own most recent removal, or `null` when neither count is
   *  above zero — the healthy-league state, designed first because it is the common one. */
  readonly mostRecentAt: string | null;
  /** Unresolved `integrity_flags` scoped to this league — a count, never a list (ruling 6's own
   *  reasoning: an open flag is a question about a person, and that question is nobody's business
   *  but the person under it and the operator looking into it). */
  readonly openQuestions: number;
}

export interface TradeRoomContext {
  readonly weekNumber: number;
  readonly myTeamId: string;
  readonly counterparties: readonly TradeCounterpartyOption[];
  readonly rostersByTeamId: Readonly<Record<string, readonly TradeRosterPlayer[]>>;
  /** The league's own name — `held-trade-banner.tsx` (Plan D, Task 5) needs it to say the
   *  identical sentence `trade_held_for_review`'s own notice already says
   *  (`@/integrity/notices`), and a room component may never import that module as a value (the
   *  client boundary, `eslint.config.mjs`), so the page hands the name down as plain data. */
  readonly leagueName: string;
}
