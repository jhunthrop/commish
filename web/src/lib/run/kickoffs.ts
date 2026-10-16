/** Every club's games with their kickoffs, from the run's schedule, as the Matchup screen reads them
 * (spec 2026-10-16 §3): each starter's game this week on the member's clock. Written at build as
 * /data/kickoffs.json, read in the browser only by that screen. */
import { memberZone, weekdayTime } from '#lib/format/clock.ts';
import type { Schedule } from './schema.ts';

export interface KickoffGame {
	week: number;
	opponent: string;
	home: boolean;
	/** When it kicks off. A time the league has not set is the start of its day on the Eastern
	 * clock (schema.ts gameSchema). */
	kickoff: string;
}

/** Each club's games, by its code. */
export type Kickoffs = Readonly<Record<string, readonly KickoffGame[]>>;

export function kickoffsOf(schedule: Pick<Schedule, 'slates'>): Kickoffs {
	return Object.fromEntries(
		schedule.slates.map((slate) => [
			slate.abbr,
			slate.games.map(({ week, opponent, home, kickoff }) => ({ week, opponent, home, kickoff }))
		])
	);
}

const EASTERN = 'America/New_York';

/** Whether a kickoff is a day the league has not timed yet: midnight on the Eastern clock. */
function untimed(kickoff: string): boolean {
	const time = new Intl.DateTimeFormat('en-US', {
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
		timeZone: EASTERN
	}).format(new Date(kickoff));
	return time === '00:00';
}

/** A club's game in a week, as a row's line says it: "at BUF Sun 1:00 pm", "vs BUF Sun" for a day
 * not yet timed, "Bye this week", or null for a club the run does not schedule. */
export function gameLine(
	kickoffs: Kickoffs,
	team: string,
	week: number,
	zone: string = memberZone()
): string | null {
	const games = kickoffs[team];
	if (games === undefined) return null;
	const game = games.find((candidate) => candidate.week === week);
	if (game === undefined) return 'Bye this week';
	const side = `${game.home ? 'vs' : 'at'} ${game.opponent}`;
	const when = weekdayTime(game.kickoff, untimed(game.kickoff) ? EASTERN : zone);
	return `${side} ${untimed(game.kickoff) ? (when.split(' ')[0] ?? '') : when}`;
}
