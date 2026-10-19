import type { BrowserContext } from 'playwright';

/** The instant the fixture's week assumes: Saturday Oct 17 2026, noon Central. Week 6's Thursday game
 * (Oct 16 00:15 UTC) is played and its projection and game facts are read (Friday evening Central),
 * and every Sunday game is still to be played (the first, Oct 18 13:30 UTC). A shots script gives the
 * browser this clock, and the fixture API takes it as FIXTURE_CLOCK, so what is "still to be played"
 * and every read stamp agree whatever day the script runs (review 66q finding 2). Unit tests draw at
 * it too (Lane 77). */
export const FIXTURE_WEEK_CLOCK = '2026-10-17T17:00:00.000Z';

/** Tuesday Oct 13 2026, noon Central: week 6 before its projection and its game facts are read, every
 * game still to be played (Lane 66w's honest empty state). */
export const FIXTURE_UNREAD_CLOCK = '2026-10-13T17:00:00.000Z';

/** The environment variable the fixture API reads its clock from. */
export const FIXTURE_CLOCK_VARIABLE = 'FIXTURE_CLOCK';

/** The fixture API's clock: the real one, or, when `at` is set, one that starts there when the server
 * starts and runs on from it, as the browser's installed clock does. */
export function fixtureClock(at: string | undefined, started: number = Date.now()): () => number {
	if (at === undefined || at === '') return () => Date.now();
	const from = Date.parse(at);
	if (Number.isNaN(from)) throw new Error(`${FIXTURE_CLOCK_VARIABLE} "${at}" is not an instant.`);
	return () => from + (Date.now() - started);
}

/** The clock the fixture API at `origin` says it runs on (its /fixture/clock), null on the real one. */
export async function fixtureApiClock(origin: string): Promise<string | null> {
	const said = await (
		await fetch(`${origin}/fixture/clock`)
	).json<{ data: { clock: string | null } | null }>();
	return said.data?.clock ?? null;
}

/** Stops a shots script whose fixture API is not on `clock`: the browser runs on it, so every read
 * stamp and every "still to be played" would disagree with the screens (Lane 77). */
export async function requireFixtureClock(
	origin: string,
	clock: string = FIXTURE_WEEK_CLOCK
): Promise<void> {
	const running = await fixtureApiClock(origin);
	if (running !== clock)
		throw new Error(
			`The fixture API at ${origin} runs on ${running ?? 'the real clock'}: start it with ${FIXTURE_CLOCK_VARIABLE}=${clock}.`
		);
}

/** Puts a shots script's browser on `clock`, never the day the script runs. */
export async function installFixtureClock(
	ctx: Pick<BrowserContext, 'clock'>,
	clock: string = FIXTURE_WEEK_CLOCK
): Promise<void> {
	await ctx.clock.install({ time: new Date(clock) });
}
