// The recorded Sleeper league's shape in the API's words (api/internal/inseason/words.go shapeWords,
// teamsWords, startersWords), built from the league's own settings so the build's Basis notes and the
// order's basis say it alike (review 66q finding 3).
import { readFile } from 'node:fs/promises';

/** The recorded league's settings as the replay holds them: its starting spots and its teams. */
export interface LeagueShape {
	rosterPositions: readonly string[];
	teams: number;
}

const REPLAY = new URL('../../../api/internal/leaguesync/replay/sleeper/', import.meta.url);

/** The replay's league: its spots (league.json) and its teams (rosters.json). */
export async function recordedShape(): Promise<LeagueShape> {
	const read = async <T>(name: string): Promise<T> =>
		JSON.parse(await readFile(new URL(name, REPLAY), 'utf8')) as T;
	const [league, rosters] = await Promise.all([
		read<{ roster_positions: string[] }>('league.json'),
		read<unknown[]>('rosters.json')
	]);
	return { rosterPositions: league.roster_positions, teams: rosters.length };
}

/** "1 QB, 2 RB, 3 WR, 1 TE and two flex spots", or "... and two flex" (flexSpots false). */
export function startersWords(shape: LeagueShape, flexSpots: boolean): string {
	const count = (slot: string): number => shape.rosterPositions.filter((s) => s === slot).length;
	const twoFlex = count('FLEX') > 1 ? `two flex${flexSpots ? ' spots' : ''}` : 'a flex';
	const flex = count('SUPER_FLEX') > 0 ? 'a flex and a superflex' : twoFlex;
	return `${String(count('QB'))} QB, ${String(count('RB'))} RB, ${String(count('WR'))} WR, ${String(count('TE'))} TE and ${flex}`;
}

/** "a 12-team league with 1 QB, 2 RB, 3 WR, 1 TE and two flex spots". */
export function shapeWords(shape: LeagueShape): string {
	return `a ${String(shape.teams)}-team league with ${startersWords(shape, true)}`;
}

/** "12 teams with 1 QB, 2 RB, 3 WR, 1 TE and two flex". */
export function teamsWords(shape: LeagueShape): string {
	return `${String(shape.teams)} teams with ${startersWords(shape, false)}`;
}

/** The Basis note's first sentence (words.go BasisNote). */
export function shapeSentence(shape: LeagueShape): string {
	return `Points over replacement are for ${shapeWords(shape)}.`;
}
