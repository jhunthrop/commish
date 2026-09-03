import type { DraftStatus } from "@/domain/draft";
import type { DraftFormat, TeamCard } from "@/domain/league";
import type { Position } from "@/domain/player";
import type { RosterSlotConfig, RosterSlotType } from "@/domain/roster";
import type { TradeFlag, TradeVerdict } from "@/trades/fairness";
import type { TradesPageBody } from "@/trades/contract";
import type { FirstRunPlan } from "@/identity";
import type { HelpLevel } from "@/identity/preferences";
import type { FixtureLabel } from "@/league-service/nfl-schedule";
import type { PendingWaiverClaim } from "@/league-service/claims";
import type { ActivityRow } from "@/integrity/activity-view";
import type { LeagueTerms, MedianResult, NextAction, StandingsRow, WeekStatus } from "@/league";
import type { LeagueAuthority } from "@/league-service/authority";
import type { CompositionCategory } from "@/participation/composition";

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
   * The room's waiting stage (`WaitingRoom`, mounted by `room-shell.tsx` when `stage-priority`
   * says `waiting`) reads this to decide which of `WaitingRoom`'s two heroes renders: the two
   * never render at once.
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
  /**
   * Phase 3.6, Task 7: how many times this SCHEDULED draft's kickoff has rolled forward because
   * its room was not full at its target time — the same fact `PublicLeagueSummary.kickoffRolls`
   * discloses to a stranger, read here by a member on their own league's home/waiting room.
   * `0` for a draft that has never rolled, which is every `when_full` draft by construction. Read
   * through `rollNoticeSentence` (`@/matchmaking/roll`), never rendered as a bare number.
   */
  readonly kickoffRolls: number;
  /**
   * Phase 3.6, Task 9 (D1's sibling fact). `true` only for the CALLER's own team, only once the
   * draft is `'complete'`, and only when this team's `member_joined` audit event (the durable
   * record `joinLeagueInTx` already writes for every seat this codebase ever takes) landed AT OR
   * AFTER the draft's own `kickoffAt` — this team was never seated while the room actually
   * drafted, so every pick on it came from the queue, not a shrug at a live clock nobody was
   * behind. `false` for a caller with no team here (`slotPreference`'s own null case) and for
   * every draft that has not finished yet. `WaitingRoom` reads this to show "The draft ran on
   * {day} and the room picked for you from your queue" (C3) instead of the ordinary complete
   * state's "View the draft board".
   */
  readonly missedDraft: boolean;
}

export interface CreateLeagueBody {
  readonly leagueId: string;
  readonly teamId: string;
  readonly draftId: string;
}

export interface InviteBody {
  readonly code: string;
  /**
   * An absolute PATH — `/app/join/{code}` — kept for callers that only ever navigate within the
   * app (never rendered as the shareable value on its own: pasted into a text message it is not
   * a link that opens).
   */
  readonly path: string;
  /**
   * Flow analysis C-01 (2026-08-27): the value a commissioner actually copies and shares —
   * `origin + path`, the origin read off the REQUEST server-side (`originFor`,
   * `@/app/api/leagues/[leagueId]/invites/route.ts`), never assumed from the browser. A relative
   * `path` pasted into a text message is not a link that opens; this is.
   */
  readonly url: string;
  readonly expiresAt: string;
  readonly maxUses: number;
  /** How many times this code has been redeemed already — `0` for a freshly minted invite, and
   *  the fact that tells a reloaded panel (C-03) it is looking at a code someone may already have
   *  used, not a brand new one. */
  readonly uses: number;
}

/** `GET /api/leagues/[leagueId]/invites`'s success payload (flow analysis C-03): every LIVE
 *  invite this league holds right now — not expired, not used up — newest first. A commissioner
 *  who reloads the page sees the code they already sent, instead of the panel offering "Create
 *  invite link" again and minting a second one silently. */
export interface InviteListBody {
  readonly invites: readonly InviteBody[];
}

export interface JoinBody {
  readonly leagueId: string;
  readonly teamId: string;
  readonly alreadyMember: boolean;
}

/**
 * `POST /api/public/leagues/[leagueId]/hold`'s success payload (Phase 3.6, Task 6). Just the
 * expiry — the token itself never rides the response body at all, only the httpOnly cookie the
 * route sets alongside it, so a caller reading this JSON can render the countdown without ever
 * being able to read (or forge) the hold it is counting down on.
 */
export interface SeatHoldBody {
  readonly expiresAt: string;
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
  /** The current run, in the sport's own spelling ("W3", "L2"), or null before any settled
   *  matchup. Head-to-head results only — a median league's phantom second game is a record
   *  fact, not a streak fact (the tab loop, 2026-08-30). */
  readonly streak: string | null;
  /**
   * This team's place in the league right now, 1-based — the server's own ranking, never
   * re-derived in React. The table renders it as the row's position numeral, and it stays fixed
   * when a reader re-sorts the table by points: a seed is a fact about the season, not about
   * whichever column is currently driving the visible order.
   */
  readonly rank: number;
  /**
   * Where this team stood BEFORE the most recent settled week, or `null` when the league has no
   * previous ranking to compare against — its first settled week, or none at all. Law 2 wants the
   * movement and law 7 forbids inventing it, so a league with nothing behind it prints a dash.
   * Computed by `leagueStandings` (`@/league-service/results.ts`) as a second pass of the same
   * `computeStandings` over the same rows with the latest week held out.
   */
  readonly previousRank: number | null;
  /** Can no longer be caught for a playoff spot. Computed server-side, never in React. */
  readonly clinched: boolean;
  readonly ownerDisplayName: string;
  /** The owner's STORED avatar ref, not a URL — same contract as `TeamCard.ownerAvatarUrl`. */
  readonly ownerAvatar: string | null;
}

/**
 * One league member as the members panel (`LeagueMembersPanel`) renders it: `TeamCard` plus
 * the one raw fact needed to find the commissioner among peers. `ownerUserId` is never shown —
 * it is only ever compared against `LeagueHomeBody.authority`'s member branch to mark the single
 * row that runs the league (no row is marked at all in a house league's `authority.kind ===
 * "house"` case). That comparison, and the display name and face it sits beside, are fair game
 * inside a league by design: the public-browse contract (Task 6) is the one place commissioner
 * identity stays hidden, and this panel is members-only.
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
  /**
   * Phase 3.6, Task 10, Step 1b (F1): whether THIS manager already has a `lineup_slots` row for
   * `weekNumber` — the same `notExists(lineupSlots WHERE teamId AND weekNumber)` predicate
   * `leaguesNeedingAutoSetQuery` (`@/league-service/auto-lineup.ts`) already asks, folded into
   * `crossLeagueHome`'s own grouped reads rather than a second query per league. `true` for a
   * caller with no team here (`myTeamId === null`) — there is nothing to fix, so the value never
   * disagrees with `nextAction`, which already gates `fix-lineup` on `myTeamId !== null`.
   */
  readonly lineupSet: boolean;
  /** Whether this league plays a median game (Task 2's toggle) — read straight off the `leagues`
   *  row `crossLeagueHome` already selects, zero extra cost. `LeagueBoard`'s second-result cell
   *  reads this to render a median line instead of reusing the head-to-head vs-block. */
  readonly medianGame: boolean;
  /** This week's own stored league median (`weeks.median_score`), or `null` before the week has
   *  settled — read from the SAME `medianByWeekByLeague` fold `crossLeagueHome` already builds
   *  for `record`, never a second query. Meaningless when `medianGame` is `false`. */
  readonly medianScore: number | null;
  /**
   * Phase 3.6, Task 10, Step 2b: the three facts the pre-draft hero needs, off the SAME `drafts`
   * row `crossLeagueHome` already selects (`DraftMembershipRow`, `@/league-service/read.ts`) —
   * three more columns, never a second query. `null`/`0` for a league with no draft row at all
   * (the same never-true defensive case `draftId`/`draftStatus` already carry).
   */
  readonly kickoffAt: string | null;
  readonly startTrigger: "scheduled" | "when_full" | null;
  readonly kickoffRolls: number;
  /** This manager's own team name in this league, off the SAME `teamRows`/`nameById` fold
   *  `crossLeagueHome` already builds — `null` only for a caller with no team here. The
   *  pre-draft hero's inlined `checklistItems` (`./waiting-room.tsx`) reads this for its "Name
   *  your team" row, the same fact `WaitingRoom` itself reads from its own `teams` prop. */
  readonly myTeamName: string | null;
}

/**
 * The one live fact the top bar (and, per Task 10 Step 3, the board itself) can carry — `null`
 * outside a real game window (ruling 12: nothing live means no pill, never one that pulses on a
 * Tuesday in July). `weekday`/`gamesLive` are both real, server-derived facts: see
 * `liveStateFor` (`@/league-service/home.ts`) for how they are computed, and its own docblock for
 * the coarseness this product accepts rather than modeling a per-game kickoff window it does not
 * have (the same tradeoff `isLineupLocked`'s own docblock names: "coarse and correct beats fine
 * and absent").
 */
export interface LiveState {
  /** "Sunday" — the real weekday, from the server clock, never a stored or guessed value. */
  readonly weekday: string;
  /** `stat_weeks.games_total - stat_weeks.games_final` for the one week currently `in_progress`,
   *  always positive when this type is constructed at all (`liveStateFor` returns `null` rather
   *  than a zero count). */
  readonly gamesLive: number;
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
  /**
   * Phase 3.6, Task 10, Step 3: the SAME fact `shellData` (`@/components/app-shell/shell-data`)
   * threads into `TopBar` — computed once, in `crossLeagueHome`, from the `stat_weeks` rows it
   * already reads for `weekStatus`, and reused by `shellData` rather than recomputed a second way.
   */
  readonly liveState: LiveState | null;
}

export interface LeagueHomeBody {
  readonly leagueId: string;
  readonly name: string;
  readonly format: DraftFormat;
  readonly teamCount: number;
  readonly rosterSlots: readonly RosterSlotConfig[];
  readonly isCommissioner: boolean;
  /** Who runs this league — a named member, or the platform for a house league (Phase 3.5
   *  addendum, Task 12). Never rendered as raw text on its own: `LeagueMembersPanel` reads the
   *  member branch's `userId` to mark the one row that runs the league, and reads the `house`
   *  branch to show "Run by Commish" instead of marking any row at all. */
  readonly authority: LeagueAuthority;
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
  /**
   * D1, the seating moment (Task 9, Step 2b). `clock.now() - joinedAt < UI_CONFIG.waitingRoom.
   * justSeatedMinutes`, where `joinedAt` is the SAME `member_joined` audit timestamp
   * `DraftScheduleBody.missedDraft` reads, computed server-side against an injected `Clock`
   * (never `Date.now()` in a component). Derived-only: no seen-flag, no snooze, no column of its
   * own — it simply stops being true once the window passes. `false` for a caller with no team
   * here.
   */
  readonly justSeated: boolean;
  /**
   * The room's coarse composition, the SAME three-bucket reduction `PublicLeagueSummary`
   * discloses to a stranger (`compositionCategoryFor`, `@/participation/composition`) — never the
   * raw newcomer/veteran counts, which would re-open the privacy ruling that reduction exists to
   * keep closed (ruling 19). `RoomRoster` renders this rather than a per-manager history tag.
   */
  readonly compositionCategory: CompositionCategory;
}

export interface MatchupLineupEntry {
  readonly slot: RosterSlotType;
  readonly slotIndex: number;
  readonly playerId: string | null;
  readonly playerName: string | null;
  readonly position: Position | null;
  /**
   * GAMEDAY, LAW 3 — *"a player is an object: face, team colour, position, number."* These three
   * fields are what let a season surface draw one. Every value here was ALREADY in hand: the
   * `matchupWeek` read (`@/league-service/read.ts`) loads the whole `players` table into
   * `playerById` to resolve names and positions, so a club code and a headshot cost this wire
   * three columns and zero queries.
   *
   * They are REQUIRED, not optional, for the reason `Player.headshotUrl` states on the domain
   * type: a caller must never have to guess whether an absent field means "this player has none"
   * or "whoever built this entry forgot". `null` on all three is the one spelling of an EMPTY
   * SLOT — no player, so no club, no face and no draft position.
   *
   * The fourth of law 3's attributes, the jersey number, is not here because it is nowhere in the
   * feed this product maps (`PlayerFace`'s own docblock carries the full argument). An invented
   * number is worse than an absent one.
   */
  readonly nflTeam: string | null;
  readonly headshotUrl: string | null;
  readonly adp: number | null;
  /**
   * `null` when this player has no stat line for the week yet — "has not played" and "played
   * and scored nothing" are different facts (`MatchupSide.score`'s own team-level rule, and
   * `initialScores`' docblock, `live-matchup-week.tsx`), and coalescing the first into the
   * second used to print `0.00` beside a player who simply had not kicked off. A caller renders
   * `null` the same way it already renders a `null` team score — a dash, never a zero.
   */
  readonly points: number | null;
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
  /**
   * `stat_weeks.games_final` / `stat_weeks.games_total` for THIS week — the same two columns
   * `ScoreUpdatePayload` carries on every live frame (`parseScoreFrame`, `use-live-scores.ts`)
   * and `liveStateFor` already reduces for the top bar's own live pill (`@/league-service/home`).
   * Read here so the matchup page itself can say how much of the week has played instead of
   * discarding a fact the browser is already holding — `0`/`0` for a week with no `stat_weeks`
   * row yet (mirroring `weekStatusFor`'s own "scheduled" default), never `null`: a week that has
   * not started has genuinely zero of zero games final, which is a true sentence, not a missing
   * one.
   */
  readonly gamesFinal: number;
  readonly gamesTotal: number;
}

export interface LineupSlotView {
  readonly slot: RosterSlotType;
  readonly slotIndex: number;
  readonly playerId: string | null;
  readonly playerName: string | null;
  readonly position: Position | null;
  /**
   * GAMEDAY, LAW 3, the same three fields `MatchupLineupEntry` carries and for the same reason:
   * a lineup editor that draws nine dropdowns full of strings is drawing no players at all.
   * `lineupView` (`@/league-service/lineups.ts`) already loads the whole `players` table to
   * resolve `playerName`/`position`, so these cost three columns off a map lookup that had
   * already happened. `null` on all three is the one spelling of an EMPTY SLOT.
   */
  readonly nflTeam: string | null;
  readonly headshotUrl: string | null;
  readonly adp: number | null;
  /** His current designation off the harvested injuries feed ("Q", "O", "IR"), or null when the
   *  feed does not name him — the chip beside the name, and the Move-to-IR affordance's gate. */
  readonly injuryDesignation?: string | null;
}

export interface LineupBody {
  readonly weekNumber: number;
  /**
   * True once the week has ENDED (`stat_weeks` says final) — the whole grid renders read-only.
   * Mid-week the grid stays open and `lockedPlayerIds` below carries the per-game locks
   * (roadmap item 2, 2026-08-30: players lock individually at their own kickoff).
   */
  readonly locked: boolean;
  /** Players whose NFL game has started this week — locked in place until the week ends. Empty
   *  before the week's first kickoff and irrelevant once `locked` is true. */
  readonly lockedPlayerIds: readonly string[];
  readonly starters: readonly LineupSlotView[];
  readonly bench: readonly LineupSlotView[];
  /** This team's injured reserve (roadmap item 3): owned but off the roster map. `slot` on
   *  these entries is the BENCH spelling only because the view type demands one — an IR entry
   *  has no slot, and the editor renders its own IR section. */
  readonly injuredReserve: readonly LineupSlotView[];
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
  /**
   * GAMEDAY, LAW 3, the same three fields the matchup and lineup wires carry. A trade is the one
   * place in this product where a manager is comparing PEOPLE, and the card drew a position chip
   * beside a string. These arrive from the SAME `matchupWeek` read this context is already built
   * from (`rosterOf`, the trades page), so they cost nothing beyond three fields on a shape that
   * was already crossing the boundary.
   *
   * NOT folded into `ValuedPlayer` (`@/trades/fairness`), which is the fairness engine's own
   * currency type: a headshot is not a valuation input, and widening a domain type so a card can
   * draw a face is how a display concern ends up inside a collusion sweep.
   */
  readonly nflTeam: string;
  readonly headshotUrl: string | null;
  readonly adp: number | null;
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

/**
 * EVERYTHING THE LEAGUE ROOM RENDERS FROM, assembled once, server side, by `room-data.ts`
 * beside the pages and handed to `RoomShell` whole. One object rather than a dozen props
 * because the room's five routes (the room itself plus the four full-height drawer surfaces)
 * all load the identical set — the route only decides which surface starts expanded.
 *
 * Every field is a read the services already answer; the maps ride the RSC boundary as
 * `Map`s (React 19 serializes them, the same way `LineupEditor` already receives
 * `projectionsByPlayerId`). Nothing here is a forecast the platform does not compute: no
 * rest-of-season splits, no projected finals, no win probability.
 */
export interface RoomData {
  readonly home: LeagueHomeBody;
  readonly lineup: LineupBody | null;
  /** The whole current-week slate (rosters, per-player points) — null pre-draft or pre-schedule. */
  readonly week: MatchupWeekBody | null;
  /** This week's per-player projections. Legitimately empty on a stale snapshot. */
  readonly projectionsByPlayerId: ReadonlyMap<string, number>;
  /** This week's fixture per NFL team; an absent team is on bye. */
  readonly fixturesByNflTeam: ReadonlyMap<string, FixtureLabel>;
  /** Each NFL team's bye week, derived from the real schedule. */
  readonly byeWeeksByNflTeam: ReadonlyMap<string, number>;
  /** The viewer's trade bands — null for a commissioner with no team. */
  readonly trades: TradesPageBody | null;
  /** The viewer's filed waiver claims with their true place in line. */
  readonly pendingClaims: readonly PendingWaiverClaim[];
  /** First page of league activity, for the pulse's "since you left" and the activity surface. */
  readonly activityRows: readonly ActivityRow[];
  readonly activityNextBefore: number | null;
  /** The viewer's own platform notices for this league — the activity surface's "what the
   *  platform did" band. Loaded only when the activity route asked for it; empty elsewhere. */
  readonly activityNotices: readonly PlatformNoticeView[];
  /** The trade surface's composer context — null for a viewer with no team. */
  readonly tradeContext: TradeRoomContext | null;
  readonly helpLevel: HelpLevel;
}

/** One platform notice as the activity surface renders it: pre-resolved server-side (the quote
 *  comes from `quoteFor`, a server-only read), so the client band is plain data. */
export interface PlatformNoticeView {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly quote: string | null;
}
