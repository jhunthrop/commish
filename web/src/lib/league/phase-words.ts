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
import { fixed, ordinal } from '#lib/format/number.ts';
import type { ContextLeague } from '#lib/context/words.ts';
import type { LeagueScreen, RailKey } from '#lib/ui/nav.ts';
import type { LeagueStanding, LeagueSync, MatchupSide } from './api.ts';
import { recordWords, scoreUnread, teamName } from './model.ts';

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
/** The league page's verb before the draft and after the season. */
export const MOCK_VERB = 'Start a mock draft';
/** The cheat sheet's way in beside it. */
export const SHEET_LINK = 'Cheat sheet';
/** The account page's Next draft rows in season, where the draft prep has left the rail: each
 * page by its rail word, a line, and its verb. */
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

/** Whether a rail is the season's, where the account page shows the Next draft rows. */
export function railInSeason(rail: RailKey): boolean {
	return rail === 'in_season' || rail === 'playoffs' || rail === 'playoffs_waivers';
}

/** The league page's matchup line's way to the Matchup screen. */
export const SEE_MATCHUP = 'See the matchup';

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

/** A side's score so far, one decimal, or nothing before its first point or when unread. */
function scoreOf(side: MatchupSide): string | null {
	return scoreUnread(side) || side.points === 0 ? null : fixed(side.points);
}

/** The league page's one matchup line, linking to the Matchup screen: "Week 6, Ertz Hurts 77.1,
 * Muttdogs 84.2.", "Week 6, Ertz Hurts against Muttdogs. No games played yet.", an all-play week's
 * own score, or null with no game read this week. */
export function matchupSummary(
	sync: Pick<LeagueSync, 'matchup' | 'teams' | 'week_all_play'>
): string | null {
	const matchup = sync.matchup;
	if (matchup === null) return null;
	const week = `Week ${String(matchup.week)}`;
	const name = (side: MatchupSide): string => teamName(sync, side.roster_id);
	const mine = name(matchup.mine);
	const myScore = scoreOf(matchup.mine);
	if (matchup.opponent === null) {
		const so = myScore === null ? '' : ` ${mine} ${myScore} so far.`;
		return sync.week_all_play
			? `${week}, an all-play week.${so}`
			: `${week}, no opponent this week.`;
	}
	const theirs = name(matchup.opponent);
	const theirScore = scoreOf(matchup.opponent);
	if (myScore === null && theirScore === null) {
		return `${week}, ${mine} against ${theirs}. No games played yet.`;
	}
	return `${week}, ${mine} ${myScore ?? fixed(0)}, ${theirs} ${theirScore ?? fixed(0)}.`;
}
