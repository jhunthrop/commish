// Lane 103's two rules on the fixture's trades, as the API's search applies them (inseason
// trades.go need and proposable), stamped when serve.ts loads the answer: a trade names the empty
// starting spot of this week's lineup it fills (no one of the member's who can play fills it, and the
// trade leaves no filled spot empty), and a trade that sends out the top player at his position in
// our order is listed only when it gains the member KEEP_GAIN a week or more or fills a need. The
// lineup is week.ts's stand-in for the engine's; only the rules are meant to hold.
import type {
	LineupAdvice,
	PlayerLine,
	TradeAdvice,
	TradeRow
} from '../../src/lib/league/inseason/api.ts';
import { KEEP_GAIN, slotLabel, tradeNeedWords, weekSlots } from './week.ts';

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

/** Whether the row is listed (trades.go proposable). */
function proposable(row: TradeRow): boolean {
	return (
		row.my_gain >= KEEP_GAIN ||
		(row.need ?? null) !== null ||
		!row.give.some((l) => l.position_rank === 1)
	);
}

/** The answer with each row's need stamped and the rows the keep rule refuses left out. */
export function proposedTrades(trades: TradeAdvice, lineup: LineupAdvice): TradeAdvice {
	const roster = rosterOf(lineup);
	const slots = lineup.slots.map((s) => s.slot);
	return {
		...trades,
		teams: trades.teams.map((team) => ({
			...team,
			trades: team.trades
				.map((row) => ({ ...row, need: needOf(row, roster, slots) }))
				.filter(proposable)
		}))
	};
}
