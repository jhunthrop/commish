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

/** The week's Sunday stand-in read (sunday.ts): 1:52 pm Central, the noon games in their fourth
 * quarter, the late games still to kick off. */
export const FIXTURE_SUNDAY_READ = '2026-10-18T18:52:00.000Z';

/** The browser's clock for a shot of that Sunday (Lane 79): four minutes after its read, as the
 * stand-in API's reads are four minutes old. Lane 80's Sunday too: the noon games kicked off with no
 * final, London's and Thursday's final by the hourly status (data/game-status.json). */
export const FIXTURE_SUNDAY_CLOCK = '2026-10-18T18:56:00.000Z';

/** Monday Oct 19 2026, 11:00 am Central (Lane 80): every Sunday game final by the hourly status, their
 * stats not in yet, Monday night's ahead. */
export const FIXTURE_MONDAY_CLOCK = '2026-10-19T16:00:00.000Z';

/** Monday Oct 19 2026, 7:40 pm Central (Lane 92): every Sunday game final, the Monday night game in
 * its first quarter, the live window. */
export const FIXTURE_LIVE_CLOCK = '2026-10-20T00:40:00.000Z';

/** Monday Oct 19 2026, 11:00 pm Central (Lane 95): Monday night's game under way, so every starter of
 * the member's has kicked off or is final and the action screens address week 7, whose published
 * projection is not read until its Thursday slot. */
export const FIXTURE_MONDAY_NIGHT_CLOCK = '2026-10-20T04:00:00.000Z';

/** Tuesday Oct 20 2026, noon Central (Lane 80): every week 6 game final, Monday night's included. */
export const FIXTURE_TUESDAY_CLOCK = '2026-10-20T17:00:00.000Z';

/** Wednesday Oct 21 2026, 7:00 pm Central (Lane 111): our week 6 stats have landed (research JOBS.md, the
 * weekly pass by Wednesday evening), so Avg, Last and GP count them, never the platform's points. */
export const FIXTURE_STATS_CLOCK = '2026-10-22T00:00:00.000Z';

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

/** What the fixture API at `origin` says of its clock (its /fixture/clock): the instant FIXTURE_CLOCK
 * started it at, null on the real clock, and the instant it reads now. */
export interface FixtureApiClock {
	clock: string | null;
	now: string;
}

export async function fixtureApiClock(origin: string): Promise<FixtureApiClock> {
	const said = await (
		await fetch(`${origin}/fixture/clock`)
	).json<{ data: FixtureApiClock | null }>();
	if (said.data === null)
		throw new Error(`The fixture API at ${origin} said nothing of its clock.`);
	return said.data;
}

/** Stops a shots script whose fixture API is not on `clock`: the browser runs on it, so every read
 * stamp and every "still to be played" would disagree with the screens (Lane 77). */
export async function requireFixtureClock(
	origin: string,
	clock: string = FIXTURE_WEEK_CLOCK
): Promise<void> {
	const running = (await fixtureApiClock(origin)).clock;
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

/** Puts a shots script's browser at the fixture API's own instant now, so every read stamp the API
 * makes is as old to the page as it is to the API, however long the API has run (Lane 77). */
export async function installFixtureApiClock(
	ctx: Pick<BrowserContext, 'clock'>,
	origin: string
): Promise<void> {
	await installFixtureClock(ctx, (await fixtureApiClock(origin)).now);
}
