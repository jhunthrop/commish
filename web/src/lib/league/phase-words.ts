/** What the site says of a league's place in its season (spec 2026-10-16 §2, §3): the follow page's
 * line for the screen a rail item led there from, the switch's word beside a league when the
 * account's leagues differ, the league page's draft line and final standing, and the league page's
 * one matchup line. Every instant on the member's own clock. Pure, so every sentence is tested. */
import {
	dayAndTime,
	memberZone,
	sameDay,
	shortDay,
	timeOfDay,
	weekdayTime
} from '#lib/format/clock.ts';
import { ordinal } from '#lib/format/number.ts';
import type { ContextLeague } from '#lib/context/words.ts';
import { MOCK_VERB, type LeagueScreen } from '#lib/ui/nav.ts';
import type { LeagueStanding } from './api.ts';
import { recordWords } from './model.ts';

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
	return `${team} finished ${ordinal(standing.place)} of ${String(standing.teams)} at ${recordWords(standing)}.`;
}
