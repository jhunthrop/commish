/** A game's facts as the screens say them (Lane 66a): the expected score and margin from the hourly
 * capture, the roof, and the kickoff forecast, each a fact with its read time, never a projection.
 * "Expected to win by 3, 47.5 points in the game. 52°F and 14 mph wind at kickoff, outdoors. Read Sun
 * 9:05 am." The lineup, waivers and trades rows read them from WeekFacts, the Matchup screen and the
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

const KIND_WORDS: Readonly<
	Record<NonNullable<NonNullable<GameConditions['weather']>['precipitation_kind']>, string>
> = {
	none: 'rain or snow',
	rain: 'rain',
	thunderstorms: 'storms',
	snow: 'snow',
	ice: 'sleet or freezing rain'
};

/** A figure the books quote in halves: "47", "47.5". */
function halves(points: number): string {
	return Number.isInteger(points) ? String(points) : fixed(points, 1);
}

/** How the margin is said from his club's side (the round 4 lock's copy rule, its L5): never the
 * spread's own idiom. */
const MARGIN_WORDS: Readonly<Record<NonNullable<GameConditions['spread']>['side'], string>> = {
	favoured: 'Expected to win by',
	underdog: 'Expected to lose by',
	even: 'Expected to be even'
};

/** "Expected to win by 3, 47.5 points in the game.", "47.5 points expected in the game." without a
 * margin, null without the figures. */
export function figuresWords(c: GameConditions): string | null {
	if (c.game_total === null) return null;
	const points = halves(c.game_total.points);
	const spread = c.spread;
	if (spread === null) return `${points} points expected in the game.`;
	const margin =
		spread.side === 'even'
			? MARGIN_WORDS.even
			: `${MARGIN_WORDS[spread.side]} ${halves(spread.points)}`;
	return `${margin}, ${points} points in the game.`;
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

/** His club's game in a week's answer, null without one. */
export function clubGame(week: GameWeek, team: string): ClubGame | null {
	return week.games.find((g) => g.team === team) ?? null;
}

/** A player page's week line: "Week 7: at SEA Sun 7:20 pm. Expected to lose by 3, 47.5 points in
 * the game. 49°F and 14 mph wind at kickoff, outdoors. Read Sun 9:05 am.", null once his game is played. */
export function clubGameLine(
	week: GameWeek,
	game: ClubGame,
	zone: string = memberZone()
): string | null {
	if (game.played) return null;
	const side = game.home ? 'vs' : 'at';
	const head = `Week ${String(week.week)}: ${side} ${game.opponent} ${weekdayTime(game.kickoff, zone)}.`;
	const facts = gameFactsLine(game, zone);
	return facts === null ? head : `${head} ${facts}`;
}
