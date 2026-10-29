// The Waivers and Trades answers at the fixture's clock, as the API gives them (Lane 85 fix round 4):
// the Gain sentence over the weeks the order covers from its first week at the clock (words.go
// weekSpan; Lane 86 moves that week on once every week 6 game has kicked off), and the one pickup
// rule from each row's own game state (inseason season_order.go): once any row's add, or the drop it
// names, has kicked off or is final at the clock, the adds by the season Gain, every week figure
// withheld, the strip the first row worth making (into an open roster spot or with its own drop).
// The engine never starts an add past his kickoff, so such a row says he does not start.
import type { TradeAdvice, WaiverAdvice, WaiverRow } from '../../src/lib/league/inseason/api.ts';
import { stateAt } from './game-state.ts';
import { roundTenth } from './tenths.ts';
import { tradesWithRest } from './trade-rest.ts';
import { tradesBases, waiverSeasonBasis, weeksCovered, type Horizon } from './week.ts';

/** The basis once a pickup's game has kicked off (words.go SeasonOrderWords). */
export function seasonOrderWords(week: number): string {
	return `Pickups go in Gain order once their week ${String(week)} games kick off.`;
}

type Line = WaiverRow['add'];

/** His game has kicked off or is final at `now` (the API's gameStateAt); a bye is no game. */
function pastKickoff(line: Line | null, now: number): boolean {
	if (line === null || line.facts.bye) return false;
	const state = stateAt({ ...line.facts, team: line.player.team }, now);
	return state !== null && state !== 'upcoming';
}

/** A row whose add or named drop is past his kickoff at `now` (season_order.go pastKickoff). */
export function rowPastKickoff(row: WaiverRow, now: number): boolean {
	return pastKickoff(row.add, now) || pastKickoff(row.drop, now);
}

/** A row with every week figure withheld, his start gone once his own game is past its kickoff. */
function withheld(row: WaiverRow, now: number): WaiverRow {
	return {
		...row,
		week_gain: null,
		starts: row.starts && !pastKickoff(row.add, now),
		beats: row.beats && { ...row.beats, gain: null },
		drops: row.drops.map((d) => ({ ...d, week_gain: null }))
	};
}

/** A row the season order's strip may name (season_order.go worthMaking): a move to make, which the
 * API's week answer marks with a week gain (none where no drop keeps the lineup full), raising the
 * season Gain. */
function worthMaking(row: WaiverRow): boolean {
	return row.week_gain !== null && roundTenth(row.gain) > 0;
}

/** The answer in the season Gain order: the rows by the season Gain, withheld, the strip their first
 * worth making. */
export function inSeasonOrder(waivers: WaiverAdvice, now: number): WaiverAdvice {
	const ordered = [...waivers.rows].sort((a, b) => b.gain - a.gain);
	const first = ordered.findIndex(worthMaking);
	const rows = ordered.map((r, i) => ({ ...withheld(r, now), pickup: i === first }));
	const pick = rows[first];
	return {
		...waivers,
		pickup_order: 'season_gain',
		basis: seasonOrderWords(waivers.week),
		rows,
		pickups: pick === undefined ? [] : [pick],
		lineup_proj: null,
		pickups_proj: null
	};
}

/** The waiver answer at `now`, the order counting from `fromWeek` through the league's horizon: the
 * season Gain order once any row the page shows, the table's or the strip's, is past its kickoff; the
 * week's answer otherwise. */
export function waiversAtClock(
	waivers: WaiverAdvice,
	now: number,
	fromWeek: number,
	h: Horizon
): WaiverAdvice {
	const restated = { ...waivers, season_basis: waiverSeasonBasis(weeksCovered(fromWeek, h), h) };
	const locked = [...waivers.rows, ...waivers.pickups].some((r) => rowPastKickoff(r, now));
	return locked ? inSeasonOrder(restated, now) : restated;
}

/** The trade answer at `now`, its Gain and each row's rest of season (Lane 269) over the weeks from `fromWeek` through the league's horizon. */
export function tradesAtClock(trades: TradeAdvice, fromWeek: number, h: Horizon): TradeAdvice {
	const weeks = weeksCovered(fromWeek, h);
	return tradesWithRest({ ...trades, ...tradesBases(weeks, h) }, weeks, h);
}
