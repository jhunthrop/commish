// Lane 103's rule on the fixture's trades, as the API's search applies it (inseason trades.go need,
// proposable and needSaid), stamped when serve.ts loads the answer: a trade that sends out a player
// we rank first at his position is listed only when it gains the member KEEP_GAIN a week or more or
// fills an empty starting spot of this week's lineup (no one of the member's who can play fills it,
// and the trade leaves no filled spot empty), and only such a trade, listed for its need, names it.
// STAND-IN, named in the lane's report: no player on the member's roster ranks first at his position,
// so the fixture reads Sam LaPorta (on his bye in week 6) as the top tight end, which lists his trades
// that fill the empty TE and drops the one that fills nothing. The lineup is week.ts's stand-in for the
// engine's; only the rules are meant to hold.
import type {
	LineupAdvice,
	PlayerLine,
	TradeAdvice,
	TradeRow,
	TradeTeam
} from '../../src/lib/league/inseason/api.ts';
import { KEEP_GAIN, slotLabel, tradeNeedWords, weekSlots } from './week.ts';

/** The member's player the fixture ranks first at his position (the stand-in above). */
export const KEPT_STAND_IN = 'Sam LaPorta';

/** A line with the stand-in's rank. */
function ranked(line: PlayerLine): PlayerLine {
	return line.player.name === KEPT_STAND_IN ? { ...line, position_rank: 1 } : line;
}

/** The member's active roster as the Lineup answers it: the starters' spots, then the bench. */
function rosterOf(lineup: LineupAdvice): PlayerLine[] {
	return [...lineup.slots.map((s) => s.ours), ...lineup.bench];
}

/** The need the trade fills, in the API's words; null for none. */
function needOf(
	row: TradeRow,
	roster: readonly PlayerLine[],
	slots: LineupAdvice['slots'][number]['slot'][]
): string | null {
	const base = weekSlots(roster, slots);
	const out = new Set([...row.give, ...(row.drop ? [row.drop] : [])].map((l) => l.player.host_id));
	const after = weekSlots([...roster.filter((l) => !out.has(l.player.host_id)), ...row.get], slots);
	if (base.some((l, i) => l !== null && after[i] === null)) return null;
	const filled = base.findIndex((l, i) => l === null && after[i] !== null);
	if (filled < 0) return null;
	return tradeNeedWords(slotLabel(slots, filled), row.give.find((l) => l.facts.bye) ?? null);
}

/** Whether the row gives a player we rank first at his position for under KEEP_GAIN a week: listed
 * only for a need (trades.go proposable), and then saying it (needSaid). */
function onlyForANeed(row: TradeRow): boolean {
	return row.my_gain < KEEP_GAIN && row.give.some((l) => l.position_rank === 1);
}

/** A team's rows with the rule applied: a row listed only for a need keeps it, said; one with no
 * need is left out; every other row says none. */
function teamRows(
	team: TradeTeam,
	roster: readonly PlayerLine[],
	slots: LineupAdvice['slots'][number]['slot'][]
): TradeRow[] {
	return team.trades.flatMap((source): TradeRow[] => {
		const row = { ...source, give: source.give.map(ranked) };
		if (!onlyForANeed(row)) return [{ ...row, need: null }];
		const need = needOf(row, roster, slots);
		return need === null ? [] : [{ ...row, need }];
	});
}

/** The answer with the rule applied and each need said where it lists the trade. */
export function proposedTrades(trades: TradeAdvice, lineup: LineupAdvice): TradeAdvice {
	const roster = rosterOf(lineup).map(ranked);
	const slots = lineup.slots.map((s) => s.slot);
	return {
		...trades,
		roster: trades.roster.map(ranked),
		teams: trades.teams.map((team) => ({ ...team, trades: teamRows(team, roster, slots) }))
	};
}
