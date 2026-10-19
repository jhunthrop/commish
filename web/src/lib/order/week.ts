/** The kickers' and defenses' tabs in season (Lane 66w): the week as a box score, one row a club in
 * the order the API sends (Proj, ties by Avg; then the games kicked off; then the byes), each with its
 * game, Proj, Opp rank, Avg and Last, and in a league its roster and the add the API sets on the first
 * five free rows. We have no model for either position, so there is no rest-of-season order and the
 * basis says so. Pure functions over the API's answer, so every word the tab prints is tested here;
 * every figure is the API's, printed as it comes. */
import { memberZone, weekdayName, weekdayTime, zoneWord } from '#lib/format/clock.ts';
import { clubNickname } from '#lib/format/clubs.ts';
import { countWord } from '#lib/format/count-words.ts';
import type { LeagueHost } from '#lib/league/api.ts';
import {
	BOX,
	boxNumber,
	boxRow,
	factsReadAt,
	FORMAT_WORDS,
	oppRankWord,
	positionWord,
	type BoxRow
} from '#lib/league/box/box.ts';
import type { BasisPart } from '#lib/run/board-basis.ts';
import type { WeekOrderAdvice, WeekOrderRow } from './api.ts';
import { rosterBasis, rosterWords, type RosterView } from './order.ts';
import { WEEK_MANY, type WeekPosition } from './week-head.ts';

/** Each position's words: its rows in the plural, one of them, whose a row's figures are, and whose
 * club the Game cell names first. */
export const WEEK_NOUNS: Readonly<
	Record<WeekPosition, { many: string; one: string; whose: string; clubFirst: string }>
> = {
	K: { many: WEEK_MANY.K, one: 'kicker', whose: 'his', clubFirst: 'his first' },
	DEF: { many: WEEK_MANY.DEF, one: 'defense', whose: 'its', clubFirst: "the defense's first" }
};

/** Every other word the tab prints, for the copy guard. */
export const WEEK_TAB = {
	unread: 'We could not read this week just now. Try again in a minute.',
	kickedOff: 'Kicked off',
	played: 'Played',
	byeIn: 'Bye in week',
	/** The add column's head, as a screen reader hears it. */
	add: 'Add'
} as const;

/** A row as the week's table draws it. */
export interface WeekView {
	/** His board id: the sheet's key, and the Waivers screen's ?player= for his add. */
	key: string;
	position: string;
	/** The platform's id for him, which the add's rule reads. */
	hostId: string;
	box: BoxRow;
	section: WeekOrderRow['section'];
	/** His game's kickoff, which a played section's head names the day of. */
	kickoff: string | null;
	roster: { kind: NonNullable<WeekOrderRow['roster']>['kind']; words: string } | null;
	move: WeekOrderRow['move'];
}

/** One row's view: a defense is named "Titans D/ST" beside its club mark. */
export function weekView(
	row: WeekOrderRow,
	zone: string = memberZone(),
	now: number = Date.now()
): WeekView {
	const { player } = row.line;
	const box = boxRow(row.line, '', zone, false, now);
	const key = player.board_id ?? player.host_id;
	const name =
		player.position === 'DEF' ? `${clubNickname(player.team)} ${positionWord('DEF')}` : box.name;
	return {
		key,
		position: player.position,
		hostId: player.host_id,
		box: { ...box, key, name },
		section: row.section,
		kickoff: row.line.facts.kickoff,
		roster: row.roster === null ? null : { kind: row.roster.kind, words: rosterWords(row.roster) },
		move: row.move
	};
}

/** A roster chip's rows, filtered in the browser: the tab holds one row a club. */
export function weekRosterFilter(view: RosterView): (row: WeekView) => boolean {
	return (row) => view === 'everyone' || row.roster?.kind === view;
}

/** The week's projection is in once a row carries a Proj (the Floor to ceiling rule: a column no row
 * fills is not drawn). */
export function landed(advice: Pick<WeekOrderAdvice, 'rows'>): boolean {
	return advice.rows.some((row) => row.line.week_projection !== null);
}

/** A run of rows under one head; the games to play have none. */
export interface WeekSection {
	key: WeekOrderRow['section'];
	head: string | null;
	rows: WeekView[];
}

const SECTIONS: readonly WeekOrderRow['section'][] = ['to_play', 'kicked_off', 'bye'];

/** "Played Thursday" when every game kicked off is final, its days in kickoff order; else "Kicked
 * off", a game still under way among them. */
function kickedOffHead(rows: readonly WeekView[], zone: string): string {
	const final = rows.every(
		(r) => r.box.game !== null && r.box.game !== 'bye' && r.box.game.when === BOX.final
	);
	if (!final) return WEEK_TAB.kickedOff;
	const kickoffs = rows.flatMap((r) => (r.kickoff === null ? [] : [r.kickoff]));
	const days = [...new Set(kickoffs.map((at) => weekdayName(at, zone)))];
	return `${WEEK_TAB.played} ${days.join(' and ')}`;
}

/** The rows in their sections, as the API ordered them; a section with no rows is not drawn. */
export function weekSections(
	views: readonly WeekView[],
	week: number,
	zone: string = memberZone()
): WeekSection[] {
	return SECTIONS.flatMap((key) => {
		const rows = views.filter((v) => v.section === key);
		if (rows.length === 0) return [];
		const head =
			key === 'to_play'
				? null
				: key === 'bye'
					? `${WEEK_TAB.byeIn} ${String(week)}`
					: kickedOffHead(rows, zone);
		return [{ key, head, rows }];
	});
}

/** The empty state's one line, before the week's projection is in: null once it is. */
export function weekStatus(
	advice: Pick<WeekOrderAdvice, 'rows' | 'week' | 'position'>
): { lead: string; rest: string } | null {
	if (landed(advice)) return null;
	const { many } = WEEK_NOUNS[advice.position];
	return {
		lead: `Week ${String(advice.week)}'s projection for ${many} is not in yet.`,
		rest: `Until it is, there is no ${BOX.proj}, and the ${many} below are in order of ${BOX.avg}.`
	};
}

const capital = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

/** Who reads the tab: a member in a league (its id and platform), or a visitor on a board whose
 * scoring the rows are named in ("PPR", "Half PPR", "Standard": a kicker's and a defense's points
 * are the same in each). */
export interface WeekReader {
	league: { id: string; host: LeagueHost } | null;
	boardScoring: string;
}

/** The order's sentence: by Proj with the projection's scoring and read and the model we lack, or by
 * Avg until it is in. */
function orderSentence(advice: WeekOrderAdvice, reader: WeekReader, zone: string): string {
	const { many, one } = WEEK_NOUNS[advice.position];
	if (!landed(advice)) {
		return `${capital(many)} are in order of ${BOX.avg} until this week's published projection is in.`;
	}
	const scoring = advice.projection_scoring;
	const whose = scoring.league_own ? ", this league's own" : ", the closest to this league's rules";
	const how =
		advice.position === 'DEF'
			? 'on its default defense scoring'
			: reader.league === null
				? `in ${reader.boardScoring} scoring`
				: `in ${FORMAT_WORDS[scoring.format]} scoring${whose}`;
	const read = advice.projection_read_at;
	const when = read === null ? '' : `, read ${weekdayTime(read, zone)} ${zoneWord(zone)}`;
	return `${capital(many)} are in order of ${BOX.proj}, this week's published projection ${how}${when}, as we have no ${one} model of our own.`;
}

/** The rules Avg and Last leave out, said as a count with the way to the league's Settings, never a
 * list that grows with the league (the 66t ruling): null when none. */
export interface RulesLeftOut {
	text: string;
	/** "Which two", to the league's Settings; null for a visitor, whose board has no settings page. */
	link: { words: string; href: string } | null;
}

export function rulesLeftOut(
	advice: Pick<WeekOrderAdvice, 'uncounted_rules'>,
	reader: WeekReader,
	settingsHref: (league: string) => string
): RulesLeftOut | null {
	const n = advice.uncounted_rules;
	if (n <= 0) return null;
	const counted = countWord(n);
	const whose = reader.league === null ? `the ${reader.boardScoring}` : 'your';
	return {
		text: `${BOX.avg} and ${BOX.last} leave out ${counted} of ${whose} scoring rules our stats lack.`,
		link:
			reader.league === null
				? null
				: {
						words: n === 1 ? 'Which one' : `Which ${counted}`,
						href: settingsHref(reader.league.id)
					}
	};
}

/** The Game cell's sentence: its read, or that its figures come later; null with no game to play. */
function gameSentence(advice: WeekOrderAdvice, zone: string, now: number): string | null {
	if (!advice.rows.some((row) => row.section === 'to_play')) return null;
	const read = factsReadAt(
		advice.rows.map((row) => row.line),
		now
	);
	if (read === null) {
		return `The ${BOX.game} cell shows the opponent and kickoff. Expected points and weather come later in the week.`;
	}
	const { clubFirst } = WEEK_NOUNS[advice.position];
	return `${BOX.game} is each club's expected points, ${clubFirst}, and the kickoff weather, read ${weekdayTime(read, zone)} ${zoneWord(zone)}.`;
}

/** The tab's basis, every figure named once, within five rendered lines at a desk and eight on a
 * phone: the order with the model we lack, Opp rank, Avg and Last in the scoring the rows are in, the
 * Game cell's read and, in a league, whose the rosters are (at a desk only, as the order says it: the
 * phone's roster chip needs no read). The rules Avg and Last leave out follow it (rulesLeftOut). */
export function weekBasis(
	advice: WeekOrderAdvice,
	reader: WeekReader,
	zone: string = memberZone(),
	now: number = Date.now()
): BasisPart[] {
	const { many, whose } = WEEK_NOUNS[advice.position];
	const { league } = reader;
	const scoring = league !== null ? "in this league's scoring" : `in ${reader.boardScoring}`;
	const said: (BasisPart | null)[] = [
		part(orderSentence(advice, reader, zone), true),
		part(`${BOX.oppRank} is points allowed to ${many} this season, 1st the fewest.`, true),
		part(`${BOX.avg} and ${BOX.last} are ${whose} points a game and last game, ${scoring}.`, true),
		part(gameSentence(advice, zone, now), true),
		league !== null && advice.read_at !== null
			? part(rosterBasis(league.host, advice.read_at, zone), false)
			: null
	];
	return said.filter((p): p is BasisPart => p !== null);
}

function part(text: string | null, phone: boolean): BasisPart | null {
	return text === null || text === '' ? null : { text, phone };
}

/** The evidence folded under the name below a wide screen: "Opp 16th, Avg 10.6, Last 5.0", the
 * opponent's rank left out where there is none (a bye). */
export function foldedEvidence(view: Pick<WeekView, 'box'>): string {
	const { oppRank, avg, last } = view.box.evidence;
	const opp = oppRank === null ? [] : [`${BOX.opp} ${oppRankWord(oppRank)}`];
	return [...opp, `${BOX.avg} ${boxNumber(avg)}`, `${BOX.last} ${boxNumber(last)}`].join(', ');
}
