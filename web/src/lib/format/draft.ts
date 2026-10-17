/** Words and labels for picks, chance and ADP. Every screen that names a pick or a chance uses these. */

export const DEFAULT_TEAMS = 12;
const NAME_SUFFIXES = new Set(['Jr.', 'Sr.', 'II', 'III', 'IV', 'V']);
const CHANCE_FLOOR = 0.005;
const CHANCE_CEILING = 0.995;

export interface SnakeSlot {
	round: number;
	seat: number;
}

function assertPickNumber(pick: number): void {
	if (!Number.isInteger(pick) || pick < 1) {
		throw new RangeError(`A pick is a whole number from 1, got ${pick}.`);
	}
}

/** The round and seat of an overall pick in a snake draft. */
export function snakeSlot(pick: number, teams = DEFAULT_TEAMS): SnakeSlot {
	assertPickNumber(pick);
	const round = Math.floor((pick - 1) / teams) + 1;
	const index = (pick - 1) % teams;
	return { round, seat: round % 2 === 1 ? index + 1 : teams - index };
}

/** "5.08": the round and the pick within it. */
export function pickLabel(pick: number, teams = DEFAULT_TEAMS): string {
	assertPickNumber(pick);
	const round = Math.floor((pick - 1) / teams) + 1;
	const within = ((pick - 1) % teams) + 1;
	return `${round}.${String(within).padStart(2, '0')}`;
}

/** "Williams" from "Jameson Williams", "Harrison" from "Marvin Harrison Jr.". */
export function lastName(name: string): string {
	const parts = name.trim().split(/\s+/);
	const tail = parts.at(-1) ?? name;
	return NAME_SUFFIXES.has(tail) && parts.length > 2 ? (parts.at(-2) ?? tail) : tail;
}

/** "97%", "<1%", ">99%". */
export function chanceShort(chance: number): string {
	if (chance < CHANCE_FLOOR) return '<1%';
	if (chance > CHANCE_CEILING) return '>99%';
	return `${Math.round(chance * 100)}%`;
}

/** The chances as they read in a sentence: "under 1%", "97%". */
export function chanceWords(chance: number): string {
	return chanceShort(chance).replace('<', 'under ').replace('>', 'over ');
}

/** Drafters' ADP against our rank. Positive means drafters take him later than we would. */
export function draftersGap(adp: number | null, ourRank: number): number | null {
	return adp === null ? null : Math.round(adp - ourRank);
}

/** Where drafters take him against a pick, in words: "drafters take him 1 earlier". */
export function adpWords(adp: number | null, pick: number): string {
	if (adp === null) return 'no ADP yet';
	const gap = Math.round(adp - pick);
	if (gap === 0) return 'drafters take him here';
	return `drafters take him ${Math.abs(gap)} ${gap > 0 ? 'later' : 'earlier'}`;
}

const SECONDS_PER_MINUTE = 60;

/** "0:19": a pick clock as it reads on the score bug. */
export function clockLabel(secondsLeft: number): string {
	if (!Number.isInteger(secondsLeft) || secondsLeft < 0) {
		throw new RangeError(`A clock is whole seconds from 0, got ${secondsLeft}.`);
	}
	const minutes = Math.floor(secondsLeft / SECONDS_PER_MINUTE);
	const seconds = secondsLeft % SECONDS_PER_MINUTE;
	return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
