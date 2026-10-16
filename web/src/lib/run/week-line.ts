/** A player page's line for his club's game this week (Lane 66a), read after the first paint: the
 * page is built from the run, and the week's facts move hourly, so the browser asks the API for them
 * and the page's first script carries none of this. */

/** His club's game this week with its facts, null when the API has none or cannot be read. */
export async function weekLine(team: string): Promise<string | null> {
	const [{ gameWeek }, words] = await Promise.all([
		import('#lib/api/games.ts'),
		import('#lib/format/game-facts.ts')
	]);
	try {
		const week = await gameWeek();
		const game = words.clubGame(week, team);
		return game === null ? null : words.clubGameLine(week, game);
	} catch (error: unknown) {
		// eslint-disable-next-line no-console -- no user-facing text: the page stands without the line
		console.warn('player page: week facts', error);
		return null;
	}
}
