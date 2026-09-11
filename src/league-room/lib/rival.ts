import type { WeekStatus } from "@/league/week-status";
import type { LeagueMemberCard, MatchupDetail, MatchupSide } from "../contract";
import { formatPoints, formatWeek } from "./format";

export interface RivalOwner {
  readonly name: string;
  readonly avatar: string | null;
}

/** One side of your game this week: the team, the person behind it, and its one number. */
export interface RivalSide {
  readonly teamId: string;
  readonly teamName: string;
  readonly owner: RivalOwner | null;
  /** The figure and what it is. `value: null` is a dash with a reason, never a zero (P2, P11). */
  readonly figure: { readonly value: string | null; readonly basis: string };
}

export interface RivalFacts {
  readonly weekNumber: number;
  readonly mine: RivalSide;
  readonly theirs: RivalSide;
}

export interface RivalInput {
  readonly matchup: MatchupDetail | null;
  readonly myTeamId: string | null;
  readonly teams: readonly LeagueMemberCard[];
  readonly weekStatus: WeekStatus;
  readonly projectionsByPlayerId: ReadonlyMap<string, number>;
}

function ownerOf(teamId: string, teams: readonly LeagueMemberCard[]): RivalOwner | null {
  const team = teams.find((entry) => entry.id === teamId);
  return team === undefined ? null : { name: team.ownerDisplayName, avatar: team.ownerAvatarUrl };
}

function projectedTotal(side: MatchupSide, projections: ReadonlyMap<string, number>): number | null {
  if (projections.size === 0) return null;
  const known = side.starters.filter((entry) => entry.playerId !== null && projections.has(entry.playerId));
  if (known.length === 0) return null;
  return known.reduce((sum, entry) => sum + (projections.get(entry.playerId!) ?? 0), 0);
}

/**
 * The one number each side shows, with its basis. A settled score says "final"; a score while
 * games run says "so far"; before kickoff the honest number is the projection when the week's
 * snapshot has one, and a dash that says why when it does not.
 */
function figureFor(side: MatchupSide, matchup: MatchupDetail, weekStatus: WeekStatus, projections: ReadonlyMap<string, number>): RivalSide["figure"] {
  const week = formatWeek(matchup.weekNumber).toLowerCase();
  if (side.score !== null && matchup.final) return { value: formatPoints(side.score), basis: `${week}, final` };
  if (side.score !== null && weekStatus === "in_progress") return { value: formatPoints(side.score), basis: `${week}, so far` };
  if (side.score !== null) return { value: formatPoints(side.score), basis: week };
  const projected = projectedTotal(side, projections);
  if (projected !== null) return { value: formatPoints(projected), basis: `projected, ${week}` };
  return { value: null, basis: `no projection yet, ${week}` };
}

/** Your game this week as two people, or `null` when you have no game (a bye, the playoffs
 *  without you, no schedule yet). The caller says why with `weekStoryFor`. */
export function rivalFacts({ matchup, myTeamId, teams, weekStatus, projectionsByPlayerId }: RivalInput): RivalFacts | null {
  if (matchup === null || myTeamId === null) return null;
  const iAmHome = matchup.home.teamId === myTeamId;
  const mine = iAmHome ? matchup.home : matchup.away;
  const theirs = iAmHome ? matchup.away : matchup.home;
  const side = (entry: MatchupSide): RivalSide => ({
    teamId: entry.teamId,
    teamName: entry.teamName,
    owner: ownerOf(entry.teamId, teams),
    figure: figureFor(entry, matchup, weekStatus, projectionsByPlayerId),
  });
  return { weekNumber: matchup.weekNumber, mine: side(mine), theirs: side(theirs) };
}
