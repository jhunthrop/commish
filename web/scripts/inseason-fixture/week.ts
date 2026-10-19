// The week's order and a lineup's two totals, as the fixture stands in for the API's engine:
// project.ts advises the lineup and stamps each trade's change in this week's Proj with it, and
// serve.ts answers the trade builder's totals with it (Lane 66g). The API's own engine replaces all
// of it (engine.go weekKeys, trades.go WeekProj and the filler's strength); only the rules are meant
// to hold.
import type { LineupSlot, PlayerLine } from '../../src/lib/league/inseason/api.ts';

const TENTH = 10;

/** The finder's basis in the API's words (words.go TradesBasis with porWords, then pergame.go
 * RestOfSeasonBasis), for the fixture's rest-of-season order from week 6 over its 12 weeks. */
export const TRADES_BASIS =
	"Trades where both lineups gain on our rest-of-season order. Each team's best trade, yours first, among those they gain at least 0.5 a week from, then the close calls for them. The other team decides. Gain is the change in a lineup's points over replacement a week, points above what a free pickup at each position gives you: the rest of the season on our rest-of-season order, averaged over its 12 weeks, not a projection of any one week. Rest of season is his points a game on our rest-of-season projection from week 6, byes out.";

/** The builder's basis in the API's words (words.go TradeCheckBasis): it opens under the Trades basis,
 * which says what Gain and Rest of season are (review 66u finding 4). */
export const CHECK_BASIS =
	'What each lineup gains or loses on our rest-of-season order. The other team decides. Gain and Rest of season are as the Trades basis says.';

/** A figure to the tenth a page prints. */
export const tenth = (value: number): number => Math.round(value * TENTH) / TENTH;

/** Who may start this week (engine.go weekKeys): a bye or a designation that keeps him off the
 * field last, doubtful before them. */
export const tierOf = (l: PlayerLine): number => {
	if (l.facts.bye || l.player.injured_reserve) return 2;
	const status = l.facts.designation?.status;
	if (status === undefined || status === 'questionable') return 0;
	return status === 'doubtful' ? 1 : 2;
};

export const printedProj = (l: PlayerLine): number | null =>
	l.week_projection === null ? null : tenth(l.week_projection);

/** The week's order: the tier, then the Proj as printed, a player with one first, then the
 * rest-of-season order. */
export function better(a: PlayerLine, b: PlayerLine): number {
	const tier = tierOf(a) - tierOf(b);
	if (tier !== 0) return tier;
	const pa = printedProj(a);
	const pb = printedProj(b);
	if ((pa === null) !== (pb === null)) return pa === null ? 1 : -1;
	if (pa !== null && pb !== null && pa !== pb) return pb - pa;
	const ra = a.position_rank ?? Number.MAX_SAFE_INTEGER;
	const rb = b.position_rank ?? Number.MAX_SAFE_INTEGER;
	if (ra !== rb) return ra - rb;
	return (b.points_over_replacement ?? 0) - (a.points_over_replacement ?? 0);
}

const FLEX_POSITIONS = new Set(['RB', 'WR', 'TE']);

export const accepts = (slot: LineupSlot['slot'], position: string): boolean =>
	slot === position || (slot === 'FLEX' && FLEX_POSITIONS.has(position));

/** The starters an order fills the slots with: each position's own slots first, then the flex. */
function fill(
	lines: readonly PlayerLine[],
	slots: readonly LineupSlot['slot'][],
	order: (a: PlayerLine, b: PlayerLine) => number,
	may: (l: PlayerLine) => boolean
): PlayerLine[] {
	return fillSlots(lines, slots, order, may).filter((l): l is PlayerLine => l !== null);
}

/** The same fill by slot: who each slot takes, in the slots' order, null where nobody is left. */
function fillSlots(
	lines: readonly PlayerLine[],
	slots: readonly LineupSlot['slot'][],
	order: (a: PlayerLine, b: PlayerLine) => number,
	may: (l: PlayerLine) => boolean
): (PlayerLine | null)[] {
	const sorted = [...lines].filter(may).sort(order);
	const out: (PlayerLine | null)[] = slots.map(() => null);
	const pick = (at: number): void => {
		const slot = slots[at];
		const best = sorted.find(
			(l) => !out.includes(l) && slot !== undefined && accepts(slot, l.player.position)
		);
		out[at] = best ?? null;
	};
	const at = slots.map((_, i) => i);
	at.filter((i) => slots[i] !== 'FLEX').forEach(pick);
	at.filter((i) => slots[i] === 'FLEX').forEach(pick);
	return out;
}

/** This week's lineup by slot (the Lineup's rule): who each slot starts, null where no one who can
 * play is left. */
export function weekSlots(
	lines: readonly PlayerLine[],
	slots: readonly LineupSlot['slot'][]
): (PlayerLine | null)[] {
	return fillSlots(lines, slots, better, (l) => tierOf(l) === 0);
}

/** This week's Proj total of the lineup the Lineup screen sets: only a player who can play starts,
 * a starter with no Proj adds none. */
export function lineupProj(
	lines: readonly PlayerLine[],
	slots: readonly LineupSlot['slot'][]
): number {
	const starters = weekStarters(lines, slots);
	return tenth(starters.reduce((sum, l) => sum + (printedProj(l) ?? 0), 0));
}

/** The lineup's strength on the rest-of-season order: its starters' points over replacement a week
 * summed, nobody's week counted, injured reserve left out. */
export function seasonStrength(
	lines: readonly PlayerLine[],
	slots: readonly LineupSlot['slot'][]
): number {
	const starters = seasonStarters(lines, slots);
	return tenth(starters.reduce((sum, l) => sum + (l.points_over_replacement ?? 0), 0));
}

/** The players the rest-of-season lineup strength starts: by points over replacement, injured
 * reserve left out. */
export function seasonStarters(
	lines: readonly PlayerLine[],
	slots: readonly LineupSlot['slot'][]
): PlayerLine[] {
	const por = (l: PlayerLine): number => l.points_over_replacement ?? Number.NEGATIVE_INFINITY;
	return fill(
		lines,
		slots,
		(a, b) => por(b) - por(a),
		(l) => !l.player.injured_reserve && l.facts.designation?.status !== 'injured_reserve'
	);
}

/** The starters this week's lineup sets: only a player who can play starts. */
export function weekStarters(
	lines: readonly PlayerLine[],
	slots: readonly LineupSlot['slot'][]
): PlayerLine[] {
	return fill(lines, slots, better, (l) => tierOf(l) === 0);
}
