// The Waivers and Trades answers at the fixture's clock, as the API gives them (Lane 85 fix round 3):
// the Gain sentence over the weeks the order covers from its first week at the clock (words.go
// weekSpan; Lane 86 moves that week on once every week 6 game has kicked off), and the one pickup
// rule once a pickup's game has kicked off (inseason season_order.go): the adds by the season Gain,
// the strip their first worth making with its own drop, every week figure withheld.
import type { TradeAdvice, WaiverAdvice, WaiverRow } from '../../src/lib/league/inseason/api.ts';
import { stateAt } from './game-state.ts';
import { roundTenth } from './tenths.ts';
import { tradesBasis, waiverSeasonBasis, weeksCovered } from './week.ts';

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

/** A row with every week figure withheld. */
function withheld(row: WaiverRow): WaiverRow {
	return {
		...row,
		week_gain: null,
		beats: row.beats && { ...row.beats, gain: null },
		drops: row.drops.map((d) => ({ ...d, week_gain: null }))
	};
}

/** The waiver answer at `now`, the order counting from `fromWeek`. */
export function waiversAtClock(waivers: WaiverAdvice, now: number, fromWeek: number): WaiverAdvice {
	const restated = { ...waivers, season_basis: waiverSeasonBasis(weeksCovered(fromWeek)) };
	const locked = waivers.pickups.some((p) => pastKickoff(p.add, now) || pastKickoff(p.drop, now));
	if (!locked) return restated;
	const rows = [...waivers.rows].sort((a, b) => b.gain - a.gain).map(withheld);
	const first = rows.findIndex((r) => r.drop !== null && roundTenth(r.gain) > 0);
	const marked = rows.map((r, i) => ({ ...r, pickup: i === first }));
	const pick = marked[first];
	return {
		...restated,
		basis: seasonOrderWords(waivers.week),
		rows: marked,
		pickups: pick === undefined ? [] : [pick],
		lineup_proj: null,
		pickups_proj: null
	};
}

/** The trade answer at `now`, its Gain over the weeks from `fromWeek`. */
export function tradesAtClock(trades: TradeAdvice, fromWeek: number): TradeAdvice {
	return { ...trades, basis: tradesBasis(weeksCovered(fromWeek)) };
}
