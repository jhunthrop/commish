/** The week read's byline (Lane 222): when it was written, the status read it stands on and the next one
 * (B186), and, once his game is under way, the figure it was written at beside the one the card holds when
 * the published projection moved past the Proj change tile's threshold since (B185).
 *
 * The run is built once a night, so it names the write alone (`capsules/week/caption.py written_caption`):
 * a status read stamp baked into it was thirteen hours old at the Sunday 1 pm games. The page names the
 * status read its own build took (`designations.json`, its check, else its stamp: a read that found no change
 * still moves the check), and the next one: the publish hour before each kickoff window dispatches a build
 * on a newer read (`research/nightly/game_day_reads.py`), the last whole hour more than READ_BUILD_LEAD_MS
 * before the window's first kickoff. Pure, every clock passed in. */
import { kickoffAt, stampAt } from '#lib/format/clock.ts';
import { fixed } from '#lib/format/number.ts';
import type { Slate, WeekRead } from '#lib/run/schema.ts';

/** The zone the read's byline is said in, as the run says its write (`capsules/week/sheet.py CENTRAL`). */
export const CAPTION_ZONE = 'America/Chicago';
/** The web build's time from the dispatch to the deploy (`game_day_reads.py BUILD_LEAD`, 25 minutes). */
export const READ_BUILD_LEAD_MS = 25 * 60_000;
const HOUR_MS = 3_600_000;

const gamesWord = (games: number): string => (games === 1 ? 'game' : 'games');

export const READ_BYLINE = {
	/** The run's own words for the write (`caption.py written_caption`). */
	written: (stamp: string, week: number): string => `Written ${stamp}, for week ${String(week)}`,
	statusRead: (stamp: string): string => `Status read again ${stamp}, no change`,
	next: (kickoff: string, games: number): string =>
		`next before the ${kickoff} ${gamesWord(games)}`,
	nextAlone: (kickoff: string, games: number): string =>
		`Next status read before the ${kickoff} ${gamesWord(games)}`,
	/** A read under way whose published projection moved past the tile's threshold since it was written. */
	moved: (stamp: string, quoted: string, now: string): string =>
		`Written ${stamp} at ${quoted}; the published projection has moved to ${now} since`
} as const;

/** The publish hour that reads before a kickoff: the last whole hour more than the build's lead before it
 * (`game_day_reads.py read_hour`). Eastern hours are whole UTC hours. */
export function readHour(kickoff: number): number {
	return Math.floor((kickoff - READ_BUILD_LEAD_MS - 1) / HOUR_MS) * HOUR_MS;
}

/** Every game's kickoff in the run's schedule, once each (from its home club's slate), as ms. */
export function scheduleKickoffs(slates: readonly Slate[]): number[] {
	return slates.flatMap((slate) =>
		slate.games.filter((game) => game.home).map((game) => Date.parse(game.kickoff))
	);
}

/** The window the next game-day read is before, at `now`: its first kickoff and its games; null with no
 * game left in the schedule. */
export function nextReadWindow(
	kickoffs: readonly number[],
	now: number
): { kickoff: number; games: number } | null {
	const ahead = kickoffs.filter((kickoff) => readHour(kickoff) > now);
	if (ahead.length === 0) return null;
	const hour = Math.min(...ahead.map(readHour));
	const window = ahead.filter((kickoff) => readHour(kickoff) === hour);
	return { kickoff: Math.min(...window), games: window.length };
}

/** A standing read's byline at the build's clock: its write; the status read the build took when it is
 * newer than the write (`statusReadAt`, ms, null with no capture); and the next game-day read. */
export function standingByline(
	read: Pick<WeekRead, 'writtenAt' | 'week'>,
	statusReadAt: number | null,
	kickoffs: readonly number[],
	now: number
): string {
	const written = READ_BYLINE.written(stampAt(read.writtenAt, CAPTION_ZONE), read.week);
	const status =
		statusReadAt !== null && statusReadAt > Date.parse(read.writtenAt)
			? READ_BYLINE.statusRead(stampAt(new Date(statusReadAt).toISOString(), CAPTION_ZONE))
			: null;
	const window = nextReadWindow(kickoffs, now);
	const next =
		window === null
			? null
			: ([kickoffAt(new Date(window.kickoff).toISOString(), CAPTION_ZONE), window.games] as const);
	if (status === null)
		return next === null ? written : `${written}. ${READ_BYLINE.nextAlone(...next)}`;
	return next === null
		? `${written}. ${status}`
		: `${written}. ${status}; ${READ_BYLINE.next(...next)}`;
}

/** The byline of a read under way whose projection moved past the threshold: the figure it was written
 * at, the one the card holds. */
export function movedByline(writtenAt: string, quoted: number, now: number): string {
	return READ_BYLINE.moved(stampAt(writtenAt, CAPTION_ZONE), fixed(quoted), fixed(now));
}
