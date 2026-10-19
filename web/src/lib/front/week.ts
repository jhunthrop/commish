/** The front door's week (Lane 66k): every league the member follows, read once from GET /me/week,
 * as the band draws it. The chosen league leads with its score bug, the lineup's changes as the one
 * verb and its three roster facts; the other leagues follow as score bugs. Every figure is the API's
 * (the bug's sides, the changes and what they add, a pickup's Proj); these functions only word and
 * place them. Pure, with the screens' links passed in, so every sentence is tested in week.test.ts. */
import type { components } from '#lib/api/types.ts';
import { designationWord } from '#lib/format/designation.ts';
import { memberZone, weekdayTime, zoneWord } from '#lib/format/clock.ts';
import { fixed, ordinal } from '#lib/format/number.ts';
import { BOX, FORMAT_WORDS, boxRow, gameOf, slotWord, type BoxRow } from '#lib/league/box/box.ts';
import {
	changesTitle,
	shortName,
	stripSum,
	type StripSum,
	type Swap
} from '#lib/league/box/lineup.ts';
import { bugsOf, type Bug } from '#lib/league/home/home.ts';
import { agoWords } from '#lib/league/model.ts';
import { hostWords } from '#lib/league/names.ts';
import { phaseWord } from '#lib/league/phase-words.ts';

type Schemas = components['schemas'];
export type MemberWeek = Schemas['MemberWeek'];
export type WeekLeague = Schemas['WeekLeague'];
export type RosterChip = Schemas['RosterChip'];
type PlayerLine = Schemas['PlayerLine'];

/** The screens a league's band links to, by the tab's name. */
export type FrontScreen = 'league' | 'start' | 'matchup' | 'waivers';
/** A league screen's link, the route's (tabHref) on the site and a plain path in the tests. */
export type ScreenHref = (screen: FrontScreen, id: string) => string;

/** Every word the band prints that is not a team's, a league's or a player's, for the copy guard. */
export const FRONT = {
	yourRoster: 'Your roster',
	rosterAside: 'Each opens the screen that acts on it.',
	otherLeagues: 'Your other leagues',
	otherAside: 'This week. Each opens its league.',
	setYourLineup: 'Set your lineup',
	openLineup: 'Open Lineup',
	matchup: 'Matchup',
	lineup: 'Lineup',
	waivers: 'Waivers',
	bye: 'Bye',
	topPickup: 'Top pickup',
	unread: 'Your leagues this week could not be read just now.',
	tryAgain: 'Try again'
} as const;

/** A chip: a fact about the member's roster and the screen that acts on it. */
export interface FrontChip {
	key: string;
	kind: RosterChip['kind'];
	label: string;
	row: BoxRow;
	line: string;
	go: string;
	href: string;
}

/** The lineup's changes as the one verb's strip. */
export interface FrontNudge {
	week: number;
	title: string;
	sum: StripSum | null;
	swaps: Swap[];
	/** Set your lineup with changes to make, else a quiet way to the Lineup; none once the week is
	 * over. */
	verb: string | null;
	/** The API's sentence once every starter's game is final (week_done), null before. */
	done: string | null;
	solid: boolean;
	href: string;
	/** "As set on Sleeper". */
	asSet: string;
}

export interface FrontLeague {
	id: string;
	name: string;
	platform: string;
	/** "McConkey Kong Country, 1-4, 12th of 12". */
	line: string;
	bug: Bug | null;
	/** "Meyers plays first, vs HOU", null when none of his starters is still to play. */
	first: { rows: BoxRow[]; words: string } | null;
	nudge: FrontNudge | null;
	chips: FrontChip[];
	/** The phase in a word for a league with no week ("Season over"), null with a week. */
	phase: string | null;
	/** Why its week is missing, with its last read when it has one: "We could not read this league
	 * just now. Last read Sat 3:05 pm." Null when nothing is. */
	problem: string | null;
	/** The other leagues' bug foot: "Three changes, +26.9" or "Your lineup is set". */
	changes: string | null;
	matchupHref: string;
	leagueHref: string;
}

const FACT_COUNTS = ['No facts', 'One fact', 'Two facts', 'Three facts'] as const;

/** The roster head's aside, counting the chips: "Two facts this week. Each opens the screen that
 * acts on it." */
export function rosterAside(chips: number): string {
	return `${FACT_COUNTS[chips] ?? `${String(chips)} facts`} this week. ${FRONT.rosterAside}`;
}

/** A league's missing week in words, with its last read where it has one. */
function problemWords(league: WeekLeague, zone: string): string | null {
	if (league.problem === null) return null;
	return league.read_at === null
		? league.problem
		: `${league.problem} Last read ${weekdayTime(league.read_at, zone)}.`;
}

/** An other league's bug foot: its changes and what they add, from the API's summary. */
function changesWords(league: WeekLeague): string | null {
	const lineup = league.lineup;
	if (lineup === null) return null;
	const done = lineup.week_done ?? null;
	const title = changesTitle(lineup.changes, done);
	return done === null && lineup.changes > 0 && lineup.gain !== null && lineup.gain > 0
		? `${title}, +${fixed(lineup.gain, 1)}`
		: title;
}

/** The member's record and place: "1-4, 12th of 12". */
function standingWords(standing: WeekLeague['standing']): string {
	if (standing === null) return '';
	const ties = standing.ties > 0 ? `-${String(standing.ties)}` : '';
	return `${String(standing.wins)}-${String(standing.losses)}${ties}, ${ordinal(standing.place)} of ${String(standing.teams)}`;
}

/** The starters who play first, by name, with their game: "Meyers plays first, vs HOU". */
function firstOf(lines: readonly PlayerLine[], zone: string, now: Date): FrontLeague['first'] {
	const lead = lines[0];
	if (lead === undefined) return null;
	const rows = lines.map((line) => boxRow(line, '', zone, false, now.getTime()));
	const names = rows.map((r) => shortName(r.name));
	const who = names.length === 1 ? `${names.join('')} plays` : `${names.join(' and ')} play`;
	const game = gameOf(lead.facts, zone, now.getTime());
	const where = game !== null && game !== 'bye' ? `, ${game.where}` : '';
	return { rows, words: `${who} first${where}` };
}

/** A chip's words under the name: his position and club, then the fact. */
function chipLine(chip: RosterChip, row: BoxRow, zone: string): string {
	const who = `${row.position}, ${row.club}`;
	const listed = chip.line.facts.designation;
	switch (chip.kind) {
		case 'status':
			return listed
				? `${who}, a starter. Listed ${weekdayTime(listed.as_of, zone)}`
				: `${who}, a starter`;
		case 'bye':
			return chip.idle
				? `${who}. No ${row.position} of yours plays this week`
				: `${who}, a starter on bye`;
		case 'pickup':
			return chip.gain === null ? who : `${who}. +${fixed(chip.gain, 1)} ${BOX.proj} this week`;
	}
}

/** The chip's label: the designation, Bye or Top pickup. */
function chipLabel(chip: RosterChip): string {
	const listed = chip.line.facts.designation;
	if (chip.kind === 'status' && listed) return designationWord(listed.status);
	return chip.kind === 'bye' ? FRONT.bye : FRONT.topPickup;
}

/** The screen that acts on a chip: the Lineup for a starter, Waivers for a pickup or for a spot no
 * one of his can play. */
function chipScreen(chip: RosterChip): 'start' | 'waivers' {
	return chip.kind === 'pickup' || (chip.kind === 'bye' && chip.idle) ? 'waivers' : 'start';
}

export function chipsOf(
	league: WeekLeague,
	href: ScreenHref,
	zone: string,
	now: Date
): FrontChip[] {
	return league.chips.map((chip) => {
		const row = boxRow(chip.line, '', zone, false, now.getTime());
		const screen = chipScreen(chip);
		return {
			key: `${chip.kind}-${chip.line.player.host_id}`,
			kind: chip.kind,
			label: chipLabel(chip),
			row,
			line: chipLine(chip, row, zone),
			go: screen === 'start' ? FRONT.lineup : FRONT.waivers,
			href: href(screen, league.id)
		};
	});
}

/** The lineup's changes as the strip draws them, from the API's summary alone. */
export function nudgeOf(league: WeekLeague, href: ScreenHref): FrontNudge | null {
	const lineup = league.lineup;
	if (lineup === null) return null;
	const swaps = lineup.swaps.map((s): Swap => ({
		key: `${s.slot}-${s.in.host_id}`,
		slot: slotWord(s.slot),
		in: shortName(s.in.name),
		out: s.out === null ? null : shortName(s.out.name)
	}));
	const changes = lineup.changes;
	// The Lineup's own sentence once the week is over: Final, no sum and no verb, as its strip says.
	const done = lineup.week_done ?? null;
	return {
		week: league.week,
		title: changesTitle(changes, done),
		sum: stripSum(
			{
				totals: { proj: lineup.projection, pts: null, note: null },
				asSet: lineup.as_set,
				gain: lineup.gain,
				swaps
			},
			done
		),
		swaps: done === null ? swaps : [],
		verb: done !== null ? null : changes > 0 ? FRONT.setYourLineup : FRONT.openLineup,
		done,
		solid: changes > 0,
		href: href('start', league.id),
		asSet: `As set on ${hostWords(league.host)}`
	};
}

export function frontLeague(
	league: WeekLeague,
	href: ScreenHref,
	now: Date,
	zone: string = memberZone()
): FrontLeague {
	const bug = league.bug;
	const me = bug?.game.sides[0]?.roster_id;
	return {
		id: league.id,
		name: league.name,
		platform: hostWords(league.host),
		line: [league.team_name, standingWords(league.standing)].filter((p) => p !== '').join(', '),
		bug:
			bug === null || me === undefined
				? null
				: (bugsOf({ games: [bug.game] }, { teams: bug.teams, me }, now.getTime(), zone)[0] ?? null),
		first: bug === null ? null : firstOf(bug.first, zone, now),
		nudge: nudgeOf(league, href),
		chips: chipsOf(league, href, zone, now),
		phase:
			league.week === 0 && league.problem === null
				? phaseWord({ phase: league.phase, draft_at: null }, now, zone)
				: null,
		problem: problemWords(league, zone),
		changes: changesWords(league),
		matchupHref: href('matchup', league.id),
		leagueHref: href('league', league.id)
	};
}

/** The league the band leads with: the one the shell has chosen, else the first with a week, else
 * the first. */
export function leadOf(leagues: readonly WeekLeague[], chosen: string | null): WeekLeague | null {
	return (
		leagues.find((l) => l.id === chosen) ?? leagues.find((l) => l.week > 0) ?? leagues[0] ?? null
	);
}

/** "Read from Sleeper 4 minutes ago.", from a league's read; null when it was never read. */
export function readWords(league: WeekLeague, now: Date): string | null {
	if (league.read_at === null) return null;
	const seconds = Math.max(0, (now.getTime() - Date.parse(league.read_at)) / 1000);
	return `Read from ${hostWords(league.host)} ${agoWords(seconds)}.`;
}

/** The band's basis, said once for the league it leads with: whose record and points, what Proj is
 * and when it was read, and what the strip's and a pickup's figures are. */
export function weekBasis(
	league: WeekLeague,
	others: boolean,
	zone: string = memberZone()
): string[] {
	const platform = hostWords(league.host);
	const lines = [
		`Record, place and ${BOX.pts} are ${platform}'s. A team's ${BOX.proj} adds its starters as set on ${platform}.${others ? ' Your other leagues read the same way, each from its own platform.' : ''}`
	];
	const scoring = league.projection_scoring;
	if (scoring !== null) {
		const whose = scoring.league_own ? "this league's own" : "the closest to this league's rules";
		const when =
			league.projection_read_at === null
				? 'not in yet'
				: `read ${weekdayTime(league.projection_read_at, zone)} ${zoneWord(zone)}`;
		lines.push(
			`${BOX.proj} is this week's published projection in ${FORMAT_WORDS[scoring.format]} scoring, ${whose}, ${when}. The strip's gain is what the changes add, and a pickup's is the ${BOX.proj} he adds this week.`
		);
	}
	return lines;
}
