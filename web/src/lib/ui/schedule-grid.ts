import type { RunStatedGame } from '#lib/run/schedule-state.ts';

/** One club's row of the schedule grid, every value already in the words and digits it prints. */
export interface ScheduleCell {
	week: number;
	/** The opponent's code, or null on the bye. */
	opponent: string | null;
	home: boolean;
	/** The opponent's own number, formatted: "11.5". */
	value: string;
	/** One of the strongest opponents, by the population the page states. */
	hard: boolean;
	/** The game is in at the run (Lane 80): set back, so what is left reads first. */
	played: boolean;
	/** The current week's game as the run read it (Lane 223, B187): absent on every other week. */
	game?: RunStatedGame;
}

export interface ScheduleRow {
	abbr: string;
	/** "Arizona Cardinals". */
	name: string;
	href: string;
	/** The face that leads the row, named under the club: the club's top player on our board, or
	 * null for a club with none. */
	face: { src: string; name: string } | null;
	/** 1 is the hardest slate by the strength shown, null with none to show. */
	rank: number | null;
	/** The strength shown, formatted: "9.3", null with none. */
	strength: string | null;
	cells: ScheduleCell[];
}
