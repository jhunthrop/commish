/** The Lineup screen's box score (Lane 66d): our lineup slot by slot, a change showing the starter we
 * start over the host's we sit with the fact that tipped it, the bench below with the starters a
 * change sits marked. Pure, tested in lineup.test.ts. */
import { memberZone } from '#lib/format/clock.ts';
import type { LineupAdvice } from '../inseason/api.ts';
import { LINES, satIds } from '../inseason/words.ts';
import {
	boxRow,
	projTotal,
	totalsNote,
	totalsPts,
	slotWord,
	type BoxRow,
	type BoxStarter,
	type BoxTotals
} from './box.ts';

export interface LineupBox {
	starters: BoxStarter[];
	bench: BoxRow[];
	/** The bench rows a change sits, by host id. */
	benchSat: ReadonlySet<string>;
	/** Our lineup's projection and points so far, summed. */
	totals: BoxTotals;
}

export function lineupBox(
	advice: Pick<
		LineupAdvice,
		'slots' | 'bench' | 'player_points' | 'team_points' | 'projection_read_at' | 'week'
	>,
	zone: string = memberZone()
): LineupBox {
	const starters = advice.slots.map((slot): BoxStarter => {
		const row = boxRow(slot.ours, slotWord(slot.slot), zone);
		if (!slot.changed) return { row };
		return {
			row,
			sits: slot.host ? boxRow(slot.host, LINES.sit, zone) : null,
			sentence: slot.sentence
		};
	});
	const ours = starters.map((s) => s.row);
	return {
		starters,
		bench: advice.bench.map((line) => boxRow(line, '', zone)),
		benchSat: satIds(advice.slots),
		totals: {
			proj: projTotal(ours),
			pts: totalsPts(ours, advice.player_points, advice.team_points),
			note: totalsNote(ours, advice.projection_read_at !== null, advice.week)
		}
	};
}
