/** The instant the fixture's week assumes: Saturday Oct 17 2026, noon Central. Week 6's Thursday game
 * (Oct 16 00:15 UTC) is played and its projection and game facts are read (Friday evening Central),
 * and every Sunday game is still to be played (the first, Oct 18 13:30 UTC). A shots script gives the
 * browser this clock, and the fixture API takes it as FIXTURE_CLOCK, so what is "still to be played"
 * and every read stamp agree whatever day the script runs (review 66q finding 2). */
export const FIXTURE_WEEK_CLOCK = '2026-10-17T17:00:00.000Z';

/** Tuesday Oct 13 2026, noon Central: week 6 before its projection and its game facts are read, every
 * game still to be played (Lane 66w's honest empty state). */
export const FIXTURE_UNREAD_CLOCK = '2026-10-13T17:00:00.000Z';

/** Monday Oct 19 2026, 11:00 am Central (Lane 80): every week 6 Sunday game has kicked off and none
 * has its final, Thursday's is final. */
export const FIXTURE_MONDAY_CLOCK = '2026-10-19T16:00:00.000Z';

/** Tuesday Oct 20 2026, noon Central (Lane 80): the weekly pass has brought week 6's finals in. */
export const FIXTURE_TUESDAY_CLOCK = '2026-10-20T17:00:00.000Z';

/** When week 6's finals land in the fixture: the Tuesday 08:00 Eastern weekly pass that brings the
 * week's stats (research JOBS.md, `inseason`). A game kicked off before it is final from then on. */
export const FIXTURE_FINALS_AT = '2026-10-20T12:00:00.000Z';

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
