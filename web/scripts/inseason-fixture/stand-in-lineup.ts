// The fixture's lineup stand-in (Lanes 25, 138): a slot's eligible players best first, fixed slots before
// the flexes, a lineup's strength its summed points over replacement, and a waiver add's gain the change
// in that strength with the drop that costs least, over the member's own lines. build.ts draws the
// lineup, the waiver rows and the trades with it; project.ts the gain of the rows it adds from the
// stand-in run (B118), so every row's gain is the one rule. The API's own engine replaces all of it.
import type { PlayerLine, WaiverRow } from '../../src/lib/league/inseason/api.ts';
import { tenth, waiverSentence } from './run-lines.ts';

const FLEX = new Set(['RB', 'WR', 'TE']);
const SUPER_FLEX = new Set(['QB', 'RB', 'WR', 'TE']);
/** Sleeper's bench slot, which the lineup never fills. */
const BENCH = 'BN';
const DEFENSE = 'DEF';

export function eligible(slot: string, position: string): boolean {
	if (slot === 'FLEX') return FLEX.has(position);
	if (slot === 'SUPER_FLEX') return SUPER_FLEX.has(position);
	return slot === position;
}

export const vorOf = (line: PlayerLine): number => line.points_over_replacement ?? 0;
export const rankOf = (line: PlayerLine): number => line.position_rank ?? Number.POSITIVE_INFINITY;

type Filled = (PlayerLine | null)[];

/** A waiver add's own figures: the drop, the gain a week over replacement, and whether he starts. */
export type WaiverAdd = Pick<WaiverRow, 'drop' | 'gain' | 'starts' | 'sentence'>;

export interface StandInLineup {
	/** The league's slots, the bench left out. */
	slots: readonly string[];
	/** Fills the slots. thisWeek: a player on bye is never started over one who plays. preferred: the
	 * host's starters win a tie (two unranked defenses keep the one the host has in). */
	fill: (
		lines: readonly PlayerLine[],
		thisWeek: boolean,
		preferred?: ReadonlySet<string>
	) => Filled;
	strength: (filled: readonly (PlayerLine | null)[]) => number;
	fillsEvery: (filled: readonly (PlayerLine | null)[]) => boolean;
	/** The member's players he could drop: anyone but his only defense. */
	droppable: (lines: readonly PlayerLine[]) => PlayerLine[];
	/** An add's gain over the member's lines with the drop that leaves the strongest lineup. */
	waiverAdd: (add: PlayerLine, mine: readonly PlayerLine[]) => WaiverAdd;
}

export function standInLineup(rosterPositions: readonly string[]): StandInLineup {
	const slots = rosterPositions.filter((s) => s !== BENCH);
	const defenseSlots = slots.filter((s) => s === DEFENSE).length;

	const fill: StandInLineup['fill'] = (lines, thisWeek, preferred = new Set()) => {
		const out: Filled = slots.map(() => null);
		const used = new Set<string>();
		const plays = (l: PlayerLine): number => (thisWeek && l.facts.bye ? 1 : 0);
		const pick = (i: number, flex: boolean): void => {
			const slot = slots[i] ?? '';
			const best = lines
				.filter((l) => !used.has(l.player.host_id) && eligible(slot, l.player.position))
				.sort(
					(a, b) =>
						plays(a) - plays(b) ||
						(flex ? 0 : rankOf(a) - rankOf(b)) ||
						vorOf(b) - vorOf(a) ||
						Number(preferred.has(b.player.host_id)) - Number(preferred.has(a.player.host_id))
				)[0];
			if (best) {
				used.add(best.player.host_id);
				out[i] = best;
			}
		};
		slots.forEach((slot, i) => {
			if (!slot.includes('FLEX')) pick(i, false);
		});
		slots.forEach((slot, i) => {
			if (slot.includes('FLEX')) pick(i, true);
		});
		return out;
	};

	const strength: StandInLineup['strength'] = (filled) =>
		filled.reduce((sum, l) => sum + (l ? vorOf(l) : 0), 0);
	const fillsEvery: StandInLineup['fillsEvery'] = (filled) =>
		filled.every((l, i) => l !== null || slots[i] === DEFENSE);

	const droppable: StandInLineup['droppable'] = (lines) => {
		const defenses = lines.filter((l) => l.player.position === DEFENSE).length;
		return lines.filter((l) => l.player.position !== DEFENSE || defenses > defenseSlots);
	};

	const waiverAdd: StandInLineup['waiverAdd'] = (add, mine) => {
		const base = strength(fill(mine, false));
		const options = droppable(mine).map((drop) => {
			const roster = [...mine.filter((l) => l !== drop), add];
			return { drop, after: strength(fill(roster, false)), roster };
		});
		const best = options.sort((a, b) => b.after - a.after || vorOf(a.drop) - vorOf(b.drop))[0];
		const week = fill(best ? best.roster : mine, true);
		const at = week.findIndex((l) => l === add);
		const gain = best ? tenth(best.after - base) : 0;
		const drop = best?.drop ?? null;
		return {
			drop,
			gain,
			// As the API answers: he starts for you only with a gain to show.
			starts: at >= 0 && gain > 0,
			sentence: waiverSentence(add, drop, gain, at >= 0)
		};
	};

	return { slots, fill, strength, fillsEvery, droppable, waiverAdd };
}
