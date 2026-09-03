import type { NextActionKind } from "@/league";
import type { HomeLeagueCard } from "../contract";
import { formatDraftAbsolute, formatPoints, ordinal } from "./format";

/**
 * THE RAIL'S OWN LANGUAGE (the rail redesign, 2026-09-03) — every derivation the league rail
 * needs to speak, pure over `HomeLeagueCard`, in the one module the shell read (`shellData`,
 * `@/components/app-shell/shell-data`), the flyout's live upgrade and the `/app` full-page rows
 * all share, so the three sizes of one component can never disagree about what a league's state
 * is, what order urgency puts it in, or what its one line of words says.
 *
 * `@/league` reaches this client-boundary directory as TYPES ONLY (`NextActionKind`); every
 * sentence here is built from `nextAction.label` — copy that `NEXT_ACTION_COPY` already owns and
 * that already rides the wire on the card itself — or from facts the card carries. Law 4: no
 * invented numbers, no filler, no em-dashes.
 */

/**
 * The rail's three-way read of a league — the SAME derivation `shellData` has carried since the
 * rail existed, moved here so the page-size rail reads it from the identical function.
 * `"needs-you"` is exactly `"fix-lineup"` or `"join-draft"` (F1); `"live"` is an in-progress
 * week; everything else is `"quiet"`.
 */
export type RailLeagueState = "needs-you" | "live" | "quiet";

export function railStateFor(kind: NextActionKind | undefined, weekStatus: HomeLeagueCard["weekStatus"]): RailLeagueState {
  if (kind === "join-draft" || kind === "fix-lineup") return "needs-you";
  if (weekStatus === "in_progress") return "live";
  return "quiet";
}

/** Which of the two needs-you kinds `kind` is, or `null` — kept beside `railStateFor` so the
 *  two can never independently disagree about which kinds count as needs-you (fix round 1, H1). */
export function needsYouKindFor(kind: NextActionKind | undefined): "fix-lineup" | "join-draft" | null {
  return kind === "fix-lineup" || kind === "join-draft" ? kind : null;
}

/**
 * LAW 2's ordering rank: a live draft first (nothing else matters while a seat is yours on a
 * running clock — the same precedence `nextAction`'s own ladder and the old attention queue both
 * gave it), then the lineup fixes, then live leagues, then quiet ones below the divider.
 */
function urgencyRank(league: HomeLeagueCard): number {
  const kind = league.nextAction?.kind;
  if (kind === "join-draft") return 0;
  if (kind === "fix-lineup") return 1;
  if (railStateFor(kind, league.weekStatus) === "live") return 2;
  return 3;
}

/**
 * Rail order: leagues needing the viewer first, live second, quiet after — ties keep the INPUT
 * order, which every caller passes as the shell read's own stable league order
 * (`myLeaguesOverview`: `createdAt` asc), so a quiet league never shuffles just because a
 * sibling's game went final. `Array.prototype.sort` is stable; a new array is returned, never a
 * mutation of the input.
 */
export function orderByUrgency(leagues: readonly HomeLeagueCard[]): readonly HomeLeagueCard[] {
  return [...leagues].sort((a, b) => urgencyRank(a) - urgencyRank(b));
}

/** This manager's end of the matchup and the opponent's, resolved once — the same manager's-seat
 *  rule `matchup-facts.ts` keeps: the rail only ever speaks in the second person about the
 *  viewer's own game. */
function sidesOf(league: HomeLeagueCard): { readonly mine: number | null; readonly theirs: number | null; readonly theirName: string } | null {
  const matchup = league.matchup;
  if (matchup === null) return null;
  const iAmHome = matchup.homeTeamId === league.myTeamId;
  return {
    mine: iAmHome ? matchup.homeScore : matchup.awayScore,
    theirs: iAmHome ? matchup.awayScore : matchup.homeScore,
    theirName: iAmHome ? matchup.awayTeamName : matchup.homeTeamName,
  };
}

/**
 * Which reads stand behind the line:
 * - `"shell"` is the app shell's cheap read (`shellData`) — `crossLeagueHome` WITHOUT the score
 *   cache, so a live league's Postgres scores may be stale mid-game and the line degrades
 *   honestly to "Live now" rather than quoting a number the read cannot vouch for.
 * - `"rich"` is a read that carried `getScoreCache()` (the `/app` page render, `/api/home`) —
 *   live margins are real there, so the line speaks them.
 */
export type RailLineTier = "shell" | "rich";

/** "Live · you lead 84.20 to 71.60", from real cache-backed scores — or "Live now" whenever
 *  either number is missing, in either tier. */
function liveLine(league: HomeLeagueCard, tier: RailLineTier): string {
  if (tier === "shell") return "Live now";
  const sides = sidesOf(league);
  if (sides === null || sides.mine === null || sides.theirs === null) return "Live now";
  if (sides.mine === sides.theirs) return `Live · tied at ${formatPoints(sides.mine)}`;
  const verb = sides.mine > sides.theirs ? "lead" : "trail";
  return `Live · you ${verb} ${formatPoints(sides.mine)} to ${formatPoints(sides.theirs)}`;
}

/** "4th of 12", plus the next fixture while the week is open or the settled result once it is
 *  final — the old board's score/opponent/margin columns, folded into words (law 4). */
function standingLine(league: HomeLeagueCard, rank: number): string {
  const base = `${ordinal(rank)} of ${league.filledTeams}`;
  const sides = sidesOf(league);
  if (sides === null) return base;
  if (league.weekStatus === "scheduled") return `${base} · next: vs ${sides.theirName}`;
  if (league.weekStatus === "final" && sides.mine !== null && sides.theirs !== null) {
    if (sides.mine === sides.theirs) return `${base} · tied at ${formatPoints(sides.mine)}`;
    const verb = sides.mine > sides.theirs ? "won" : "lost";
    return `${base} · ${verb} ${formatPoints(sides.mine)} to ${formatPoints(sides.theirs)}`;
  }
  return base;
}

/**
 * The one line of words under a league's name — every rung a real read (law 4), top to bottom:
 *  1. A needs-you league speaks its action's own words (`nextAction.label` — `NEXT_ACTION_COPY`,
 *     already on the card).
 *  2. A live league speaks its margin (rich tier) or "Live now" (shell tier — see
 *     `RailLineTier`).
 *  3. A league still waiting on its draft names the kickoff, or the fill trigger.
 *  4. A quiet league gets its standing and next fixture, or its settled result.
 *  5. A league with none of that speaks its one next action if it has one ("Invite managers"),
 *     else its seat count — the last fact every league genuinely has.
 */
export function railStateLine(league: HomeLeagueCard, tier: RailLineTier): string {
  const state = railStateFor(league.nextAction?.kind, league.weekStatus);
  if (state === "needs-you") return league.nextAction!.label;
  if (state === "live") return liveLine(league, tier);
  if (league.draftStatus === "scheduled") {
    if (league.startTrigger === "when_full") return "Drafts when the room fills";
    if (league.kickoffAt !== null) return `Drafts ${formatDraftAbsolute(league.kickoffAt)}`;
    return "Draft scheduled";
  }
  if (league.myRank !== null) return standingLine(league, league.myRank);
  if (league.nextAction !== null) return league.nextAction.label;
  return `${league.filledTeams} of ${league.teamCount} seats filled`;
}
