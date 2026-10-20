/** Starters right in a league's own lineup (Lane 93, ruling 4): the run grades every week in the
 * standard 12-team lineup (research/nightly/reads/record.py STARTERS_A_TEAM, 12 QBs, 24 RBs, 36 WRs
 * and 12 TEs); a page opened from a league counts the same graded players in that league's lineup,
 * flex and superflex included, from each graded week's placed players. One rule both ways: an order's
 * starters are its top players at each position's own slots, then the flex from the backs, receivers
 * and tight ends left, then the superflex from those and the quarterbacks left, only players it ranked
 * counting; the finish fills the same slots from every player; starters right is how many players
 * are in both. With no flex the count is the run's own (record-starters.test.ts holds it to it). */
import type { PlacedPlayer, RecordLine } from './schema.ts';

/** A starting lineup by our slots and the league's teams. A kicker or defense slot counts only where
 * the week graded the position (the run grades neither in season). */
export interface StartingLineup {
	teams: number;
	qb: number;
	rb: number;
	wr: number;
	te: number;
	k: number;
	def: number;
	flex: number;
	superFlex: number;
}

/** The run's own lineup, the one the record counts with no league open. */
export const STANDARD_LINEUP: StartingLineup = {
	teams: 12,
	qb: 1,
	rb: 2,
	wr: 3,
	te: 1,
	k: 1,
	def: 1,
	flex: 0,
	superFlex: 0
};

/** The order a starters count reads: ours, ADP's or the published projection's places. */
export type PlacedSource = 'ours' | 'adp' | 'published';

export interface StartersCount {
	right: number;
	of: number;
}

const DEDICATED = [
	['QB', 'qb'],
	['RB', 'rb'],
	['WR', 'wr'],
	['TE', 'te'],
	['K', 'k'],
	['DST', 'def']
] as const;
const FLEX = new Set<string>(['RB', 'WR', 'TE']);
const SUPER_FLEX = new Set<string>(['QB', 'RB', 'WR', 'TE']);

type Filled = Set<PlacedPlayer>;

/** Takes up to n of the ordered players that fit and are not taken yet. */
function take(
	ordered: readonly PlacedPlayer[],
	n: number,
	fits: (p: PlacedPlayer) => boolean,
	into: Filled
): void {
	let left = n;
	for (const player of ordered) {
		if (left === 0) return;
		if (!into.has(player) && fits(player)) {
			into.add(player);
			left -= 1;
		}
	}
}

/** The starters a ranking fills: each position's slots, the flex, the superflex. */
function fill(ordered: readonly PlacedPlayer[], slots: Slots): Filled {
	const into: Filled = new Set();
	for (const [position] of DEDICATED)
		take(ordered, slots[position], (p) => p.position === position, into);
	take(ordered, slots.flex, (p) => FLEX.has(p.position), into);
	take(ordered, slots.superFlex, (p) => SUPER_FLEX.has(p.position), into);
	return into;
}

interface Slots {
	QB: number;
	RB: number;
	WR: number;
	TE: number;
	K: number;
	DST: number;
	flex: number;
	superFlex: number;
}

/** The slots the finish can fill: never more at a position than the players graded there, so an
 * order is counted against the starters the week's graded players make (the run's own rule). */
function slotsFor(players: readonly PlacedPlayer[], lineup: StartingLineup): Slots {
	const at = (position: string): number => players.filter((p) => p.position === position).length;
	const slots: Slots = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0, flex: 0, superFlex: 0 };
	for (const [position, key] of DEDICATED)
		slots[position] = Math.min(lineup[key] * lineup.teams, at(position));
	const dedicated = slots.QB + slots.RB + slots.WR + slots.TE;
	const flexLeft =
		players.filter((p) => FLEX.has(p.position)).length - slots.RB - slots.WR - slots.TE;
	slots.flex = Math.min(lineup.flex * lineup.teams, Math.max(0, flexLeft));
	const superLeft =
		players.filter((p) => SUPER_FLEX.has(p.position)).length - dedicated - slots.flex;
	slots.superFlex = Math.min(lineup.superFlex * lineup.teams, Math.max(0, superLeft));
	return slots;
}

/** One graded week's starters right for an order in a lineup, over the given players (one position's,
 * or every graded player's). */
export function startersRight(
	players: readonly PlacedPlayer[],
	lineup: StartingLineup,
	source: PlacedSource
): StartersCount {
	const slots = slotsFor(players, lineup);
	const ranked = players
		.filter((p) => p[source] !== null)
		.toSorted((a, b) => (a[source] ?? 0) - (b[source] ?? 0));
	const finished = players.toSorted((a, b) => a.finish - b.finish);
	const called = fill(ranked, slots);
	const actual = fill(finished, slots);
	const right = [...called].filter((p) => actual.has(p)).length;
	const of = DEDICATED.reduce(
		(sum, [position]) => sum + slots[position],
		slots.flex + slots.superFlex
	);
	return { right, of };
}

/** A week's players at a position line, every graded player on the All line. */
export function playersOf(
	players: readonly PlacedPlayer[],
	position: RecordLine['position']
): readonly PlacedPlayer[] {
	return position === 'All' ? players : players.filter((p) => p.position === position);
}

/** A lineup with the flex and the superflex counted only where the line holds every position: a
 * position line counts its own slots alone. */
export function lineupFor(
	lineup: StartingLineup,
	position: RecordLine['position']
): StartingLineup {
	return position === 'All' ? lineup : { ...lineup, flex: 0, superFlex: 0 };
}
