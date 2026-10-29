/** What the site says of a league's place in its season (spec 2026-10-16 §2, §3): the follow page's
 * line for the screen a rail item led there from, the switch's word beside a league when the
 * account's leagues differ, the league page's draft line and final standing, and the league page's
 * one matchup line. Every instant on the member's own clock. Pure, so every sentence is tested. */
import {
	memberZone,
	sameDay,
	shortDay,
	timeOfDay,
	weekdayTime,
	zoneName
} from '#lib/format/clock.ts';
import type { ContextLeague } from '#lib/context/words.ts';
import { MOCK_VERB, type LeagueScreen } from '#lib/ui/nav.ts';
import type { LeagueStanding } from './api.ts';
import { placeWords, recordWords } from './model.ts';

/** The NFL's clock, which a screen's times need not name. */
const EASTERN = 'Eastern Time';

/** The member's zone said once on a screen, "Times are in Central Time.", null on the Eastern clock: the
 * league screens' line, kept out of format/clock.ts, which every page loads (Lane 284). */
export function zoneLine(zone: string = memberZone()): string | null {
	const name = zoneName(zone);
	return name === EASTERN ? null : `Times are in ${name}.`;
}

/** The weekday-month-day-and-time format for a zone, made once per zone. */
const dayTimeFormats = new Map<string, Intl.DateTimeFormat>();

function dayTimeFormat(zone: string): Intl.DateTimeFormat {
	const known = dayTimeFormats.get(zone);
	if (known) return known;
	const made = new Intl.DateTimeFormat('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZone: zone
	});
	dayTimeFormats.set(zone, made);
	return made;
}

/** "Sunday, October 25 at 7:00 pm": a day further off than this week, on the member's clock. Here,
 * not in format/clock.ts, which every page loads: only the league page says a draft day (Lane 284). */
export function dayAndTime(iso: string, zone: string = memberZone()): string {
	const parts = dayTimeFormat(zone).formatToParts(new Date(iso));
	const part = (type: Intl.DateTimeFormatPartTypes): string =>
		parts.find((p) => p.type === type)?.value ?? '';
	return `${part('weekday')}, ${part('month')} ${part('day')} at ${part('hour')}:${part('minute')} ${part('dayPeriod').toLowerCase()}`;
}

/** The follow page's line above the form, naming the screen the rail item leads to once a league
 * is followed. */
export const FOLLOW_FOR: Readonly<Record<LeagueScreen, string>> = {
	start: 'Follow your league to see your lineup each week.',
	matchup: 'Follow your league to see your matchup each week.',
	waivers: 'Follow your league to see your best waiver add each week.',
	trades: 'Follow your league to see the trades that help both teams.'
};

/** The league page's line before the draft. */
export const TURNS_AFTER_DRAFT = 'The site turns to your season after your draft.';

/** The account page's rows, and the league page's after the season, for the draft prep that
 * leaves the rail in season. */
export const NEXT_DRAFT = 'Next draft';

/** The league page's one verb on draft day: our call beside the real draft. */
export const ADVISOR_VERB = 'Open the Advisor';
/** The cheat sheet's way in beside it. */
export const SHEET_LINK = 'Cheat sheet';
/** The account page's Next draft rows out of season: each page by its rail word, a line, and its
 * verb. */
export const NEXT_DRAFT_ROWS = [
	{
		lead: 'Mock draft',
		text: 'Practice your next draft any time, against a room on our board.',
		verb: MOCK_VERB
	},
	{
		lead: SHEET_LINK,
		text: 'Your ranks and tags, kept for your next draft.',
		verb: 'Open your sheet'
	}
] as const;

/** The account page's draft prep in season (B52): from the season's first kickoff to its last game
 * the Next draft block recedes to this one line, each tool's words opening it. */
export const DRAFT_TOOLS = {
	label: 'Draft tools',
	lead: 'Draft tools:',
	mock: 'mock draft',
	joint: ', ',
	sheet: 'cheat sheet'
} as const;

const DAY_MS = 86_400_000;
/** A draft this many days off is named by its weekday, further off by its date. */
const WEEK_AHEAD_MS = 6 * DAY_MS;

/** "today" or "tomorrow" for an instant on those days of the member's clock, else null. */
function nearDay(iso: string, now: Date, zone: string): string | null {
	const at = new Date(iso);
	if (sameDay(at, now, zone)) return 'today';
	return sameDay(at, new Date(now.getTime() + DAY_MS), zone) ? 'tomorrow' : null;
}

type Phased = Pick<ContextLeague, 'phase' | 'draft_at'>;

/** A league's phase in the switch, beside its name: "Draft Mon 7:00 pm", "Draft today 7:00 pm",
 * "Drafting", "Drafted", "Playoffs", "Season over". */
export function phaseWord(league: Phased, now: Date, zone: string = memberZone()): string {
	switch (league.phase) {
		case 'in_season':
			return 'Drafted';
		case 'playoffs':
			return 'Playoffs';
		case 'offseason':
			return 'Season over';
		case 'pre_draft':
		case 'draft_day':
			return draftWord(league, now, zone);
	}
}

function draftWord(league: Phased, now: Date, zone: string): string {
	const at = league.draft_at;
	if (at === null) return league.phase === 'draft_day' ? 'Drafting' : 'Not drafted';
	const ahead = Date.parse(at) - now.getTime();
	if (ahead <= 0) return 'Drafting';
	const near = nearDay(at, now, zone);
	if (near !== null) return `Draft ${near} ${timeOfDay(at, zone)}`;
	return ahead <= WEEK_AHEAD_MS ? `Draft ${weekdayTime(at, zone)}` : `Draft ${shortDay(at, zone)}`;
}

/** The league page's draft line before the draft: "Your draft is Sunday, October 25 at 7:00 pm.",
 * "Your draft is today at 7:00 pm.", "... tomorrow at ...", "Your draft is on now.", or that the host
 * has no time. */
export function draftLine(draftAt: string | null, now: Date, zone: string = memberZone()): string {
	if (draftAt === null) return 'Your league has not set its draft time.';
	if (Date.parse(draftAt) <= now.getTime()) return 'Your draft is on now.';
	const near = nearDay(draftAt, now, zone);
	if (near !== null) return `Your draft is ${near} at ${timeOfDay(draftAt, zone)}.`;
	return `Your draft is ${dayAndTime(draftAt, zone)}.`;
}

/** The offseason's line: "Ertz Hurts finished 3rd of 12 at 9-5.", or that the season is over when
 * the last read has no standing. */
export function finalStanding(team: string, standing: LeagueStanding | null): string {
	if (standing === null || team === '') return 'Your season is over.';
	return `${team} finished ${placeWords(standing.place, standing.teams)} at ${recordWords(standing)}.`;
}
