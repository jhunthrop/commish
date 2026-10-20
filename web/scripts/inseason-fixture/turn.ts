// The week turn as the API makes it (Lane 95, api/internal/inseason advice.go addressedWeek): once
// every starter of the member's with a game has kicked off or is final at the clock (the Lineup's
// slots, the one game state), Waivers, Trades and the front door's roster facts address week 7 while
// the platform, the Lineup and the claim stay on week 6. Every row carries his week 7 game
// (data/week7-games.json, the store's provider schedule) or his bye, his week 6 designation dropped
// as spent (Season.WithoutSpent: the fixture's are all listed before his week 6 game), and no week
// figure: week 7's published projection is first captured in its Thursday slot, two hours before
// Chicago and New England kick off (advice.go projectionArrivesAt), so the pickups go by the season
// Gain (words.go UnprojectedOrderWords) and the page says when it arrives.
import { readFileSync } from 'node:fs';
import type { components } from '../../src/lib/api/types.ts';
import type { LineupAdvice, TradeAdvice, WaiverAdvice } from '../../src/lib/league/inseason/api.ts';
import { stateAt } from './game-state.ts';
import { inSeasonOrder } from './waivers-at.ts';

type PlayerLine = components['schemas']['PlayerLine'];

interface Week7Game {
	team: string;
	opponent: string;
	home: boolean;
	kickoff: string;
}

const WEEK7 = JSON.parse(
	readFileSync(new URL('./data/week7-games.json', import.meta.url), 'utf8')
) as { week: number; games: Week7Game[] };

/** The week the action screens turn to. */
export const TURNED_WEEK = WEEK7.week;

/** The harvest's lead before a kickoff slot (advice.go ProjectionCaptureLead). */
const CAPTURE_LEAD_MS = 2 * 60 * 60 * 1000;

/** When week 7's published projection is first captured: its first kickoff less the lead. */
export const WEEK7_PROJECTION_ARRIVES = new Date(
	Math.min(...WEEK7.games.map((g) => Date.parse(g.kickoff))) - CAPTURE_LEAD_MS
).toISOString();

/** The week's designations, which a game played spends; a season-long one stands. */
const WEEK_STATUSES = new Set(['questionable', 'doubtful', 'out']);

/** Whether the member's lineup has played its week at `now` (advice.go everyStarterPast at kicked
 * off): every starter with a game, a bye aside, kicked off or final; false with none. */
export function lineupSpent(lineup: LineupAdvice, now: number): boolean {
	const games = lineup.slots
		.map((s) => s.ours)
		.filter((line) => !line.facts.bye && line.facts.kickoff !== null);
	return (
		games.length > 0 &&
		games.every((line) => stateAt({ ...line.facts, team: line.player.team }, now) !== 'upcoming')
	);
}

/** His line for week 7: its game or his bye, no week figure, a week's designation spent. */
export function turnedLine(line: PlayerLine): PlayerLine {
	const game = WEEK7.games.find((g) => g.team === line.player.team);
	const designation = line.facts.designation;
	return {
		...line,
		week_projection: null,
		projection_delta: null,
		facts: {
			...line.facts,
			week: TURNED_WEEK,
			opponent: game?.opponent ?? null,
			home: game?.home ?? null,
			kickoff: game?.kickoff ?? null,
			bye: game === undefined,
			played: false,
			game_state: game === undefined ? null : 'upcoming',
			points_this_week: null,
			allowed_to_position: null,
			game_total: null,
			spread: null,
			roof: null,
			weather: null,
			designation:
				designation && WEEK_STATUSES.has(designation.status) && (designation.since ?? null) === null
					? null
					: designation
		}
	};
}

function turnedRow<T extends { add: PlayerLine; drop: PlayerLine | null }>(row: T): T {
	return { ...row, add: turnedLine(row.add), drop: row.drop && turnedLine(row.drop) };
}

/** The waiver answer for week 7: its rows' games, the season Gain order, the arrival said. */
export function turnedWaivers(waivers: WaiverAdvice, now: number): WaiverAdvice {
	const rows = waivers.rows.map(turnedRow);
	const turned: WaiverAdvice = {
		...waivers,
		for_week: TURNED_WEEK,
		projection_read_at: null,
		projection_previous_read_at: null,
		projection_arrives_at: WEEK7_PROJECTION_ARRIVES,
		rows,
		pickups: waivers.pickups.map(turnedRow),
		roster: waivers.roster.map(turnedLine)
	};
	return {
		...inSeasonOrder(turned, now),
		basis: `Pickups go in Gain order until week ${String(TURNED_WEEK)}'s published projection is in.`
	};
}

/** The trade answer for week 7: every line's game, no week change, the arrival said. */
export function turnedTrades(trades: TradeAdvice): TradeAdvice {
	return {
		...trades,
		for_week: TURNED_WEEK,
		projection_read_at: null,
		projection_arrives_at: WEEK7_PROJECTION_ARRIVES,
		roster: trades.roster.map(turnedLine),
		teams: trades.teams.map((team) => ({
			...team,
			roster: team.roster.map(turnedLine),
			trades: team.trades.map((row) => ({
				...row,
				give: row.give.map(turnedLine),
				get: row.get.map(turnedLine),
				drop: row.drop && turnedLine(row.drop),
				my_proj_change: null,
				their_proj_change: null
			}))
		}))
	};
}

/** The lineup's slots for week 7, which the front door's roster facts read. */
export function turnedLineup(lineup: LineupAdvice): LineupAdvice {
	return {
		...lineup,
		slots: lineup.slots.map((slot) => ({
			...slot,
			ours: turnedLine(slot.ours),
			host: slot.host && turnedLine(slot.host)
		}))
	};
}
