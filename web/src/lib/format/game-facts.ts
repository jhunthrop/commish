/** A game's facts as the screens say them (Lane 66a): the expected score and margin from the hourly
 * capture, the roof, and the kickoff forecast, each a fact with its read time, never a projection.
 * "Expected to score 25 and to win by 3, 47.5 points in the game. 52°F and 14 mph wind at kickoff,
 * outdoors. Read Sun 9:05 am." The lineup, waivers and trades rows read them from WeekFacts, the Matchup screen and the
 * player pages from GET /games/week. Pure, so every sentence is tested. */
import type { components } from '#lib/api/types.ts';
import { memberZone, weekdayTime } from './clock.ts';
import { fixed } from './number.ts';

type Schemas = components['schemas'];
/** The four facts WeekFacts and ClubGame share. */
export type GameConditions = Pick<
	Schemas['ClubGame'],
	'game_total' | 'spread' | 'roof' | 'weather'
>;
export type ClubGame = Schemas['ClubGame'];
export type GameWeek = Schemas['GameWeek'];

/** A chance of precipitation below this is not named: a few percent is a dry forecast. */
export const PRECIPITATION_NAMED_FROM = 20;

/** The kind is named only when the forecast names it: a chance with no kind is precipitation. */
const KIND_WORDS: Readonly<
	Record<NonNullable<NonNullable<GameConditions['weather']>['precipitation_kind']>, string>
> = {
	none: 'precipitation',
	rain: 'rain',
	thunderstorms: 'storms',
	snow: 'snow',
	ice: 'sleet or freezing rain'
};

/** A game figure in halves, as it is published: "47", "47.5". */
export function halves(points: number): string {
	return Number.isInteger(points) ? String(points) : fixed(points, 1);
}

/** "Expected to score 25 and to win by 3, 47.5 points in the game.", his club's own points and the
 * margin from its side (the round 4 lock's copy form, its L5, never the spread's own idiom); "Expected
 * to be a close game, 47.5 points in the game."; "47.5 points expected in the game." without a margin;
 * null without the figures. */
export function figuresWords(c: GameConditions): string | null {
	if (c.game_total === null) return null;
	const points = halves(c.game_total.points);
	const spread = c.spread;
	if (spread === null) return `${points} points expected in the game.`;
	if (spread.side === 'even') return `Expected to be a close game, ${points} points in the game.`;
	const team = halves(c.game_total.team_points);
	return `Expected to score ${team} and to ${spread.side} by ${halves(spread.points)}, ${points} points in the game.`;
}

export type GameState = Schemas['GameState'];

/** A game past its kickoff in a word, the one source every screen prints (Lane 80): its kickoff day
 * or time stands while it is upcoming. */
export const GAME_STATE_WORDS = {
	kicked_off: 'Kicked off',
	final: 'Final'
} as const satisfies Record<Exclude<GameState, 'upcoming'>, string>;

/** A game as the API sends it: its state (Lane 80), absent on a read from before the field, beside
 * the final flag and the kickoff. */
export interface StatedGame {
	game_state?: GameState | null;
	played: boolean;
	kickoff: string | null;
}

/** A game's state, one rule for every screen: the API's (its clock and its finals, gameStateAt in
 * inseason/facts.go), never derived here (review finding 5): a read without it has no state. */
export function gameStateOf(game: StatedGame): GameState | null {
	return game.game_state ?? null;
}

/** Where the game is played, as the end of the weather sentence or alone. */
function placeWords(c: GameConditions): string {
	return c.roof?.kind === 'retractable' ? 'under a retractable roof' : 'outdoors';
}

/** "52°F and 14 mph wind", with "and a 40% chance of snow" when the chance is worth naming. */
function forecastWords(w: NonNullable<GameConditions['weather']>): string | null {
	const parts: string[] = [];
	if (w.temperature_f !== null) parts.push(`${String(Math.round(w.temperature_f))}°F`);
	if (w.wind_mph !== null) parts.push(`${String(Math.round(w.wind_mph))} mph wind`);
	const chance = w.precipitation_chance;
	if (chance !== null && chance >= PRECIPITATION_NAMED_FROM) {
		const kind = KIND_WORDS[w.precipitation_kind ?? 'none'];
		parts.push(`a ${String(Math.round(chance))}% chance of ${kind}`);
	}
	if (parts.length === 0) return null;
	const last = parts.pop() ?? '';
	return parts.length === 0 ? last : `${parts.join(', ')} and ${last}`;
}

/** The roof and the weather: "52°F and 14 mph wind at kickoff, outdoors.", "Indoors.", "Played
 * abroad, so no forecast.", null when the venue is not confirmed and no forecast is held. */
export function weatherWords(c: GameConditions): string | null {
	if (c.roof?.abroad) return 'Played abroad, so no forecast.';
	if (c.roof?.kind === 'dome') return 'Indoors.';
	const forecast = c.weather === null ? null : forecastWords(c.weather);
	if (forecast !== null) return `${forecast} at kickoff, ${placeWords(c)}.`;
	if (c.roof === null) return null;
	return c.roof.kind === 'retractable' ? 'Retractable roof.' : 'Outdoors.';
}

/** "Read Sun 9:05 am.": the older of the two reads the line says, so neither is newer than told. */
export function readWords(c: GameConditions, zone: string = memberZone()): string | null {
	const reads = [c.game_total?.read_at, c.weather?.read_at].filter(
		(at): at is string => at !== undefined
	);
	if (reads.length === 0) return null;
	const oldest = reads.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
	return `Read ${weekdayTime(oldest, zone)}.`;
}

/** The whole line, null when nothing is held. */
export function gameFactsLine(c: GameConditions, zone: string = memberZone()): string | null {
	const said = [figuresWords(c), weatherWords(c)].filter((s): s is string => s !== null);
	if (said.length === 0) return null;
	const read = readWords(c, zone);
	return [...said, ...(read === null ? [] : [read])].join(' ');
}
