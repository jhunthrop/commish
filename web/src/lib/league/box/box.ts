/** The box score (Lane 66d): a team's players as columns, not sentences, for the Matchup and Lineup
 * screens. Each row is the slot, the player (his face, or a defense's club mark, his name, his status
 * in a word, his club and position), his game in one cell (the opponent and kickoff, then the
 * expected score with his club's first and the kickoff weather in two or three words), this week's
 * projection and his points so far. Pure functions over the API's player lines, so every word a box
 * prints is tested here. */
import { memberZone, weekdayTime, zoneWord } from '#lib/format/clock.ts';
import { defenseWords } from '#lib/format/clubs.ts';
import { lastName } from '#lib/format/draft.ts';
import {
	designationWord,
	rankWord,
	seasonLongMark,
	sitsHim,
	type DesignationStatus
} from '#lib/format/designation.ts';
import type { StatusView } from '#lib/run/status-view.ts';
import { POSITIONS, type Position } from '#lib/types/player.ts';
import { halves, toBePlayed, PRECIPITATION_NAMED_FROM } from '#lib/format/game-facts.ts';
import { fixed, ordinal, signed } from '#lib/format/number.ts';
import { clubMark } from '#lib/ui/club-mark.ts';
import type { LeagueHost, LeaguePlayer } from '../api.ts';
import { hostWords } from '../names.ts';
import type { LineupSlot, PlayerLine, ProjectionScoring, WeekFacts } from '../inseason/api.ts';

/** A slot as a box labels it: the host's own short words, a defense as "D/ST". */
export type BoxSlot = LineupSlot['slot'];

const SLOT_WORDS: Readonly<Record<BoxSlot, string>> = {
	QB: 'QB',
	RB: 'RB',
	WR: 'WR',
	TE: 'TE',
	FLEX: 'Flex',
	SUPERFLEX: 'SFlex',
	K: 'K',
	DEF: 'D/ST'
};

/** Every word a box prints that is not a player's, in one place for the copy guard. */
export const BOX = {
	slot: 'Slot',
	player: 'Player',
	game: 'Game',
	/** This week's projection, the published one until our own weekly model passes its test. */
	proj: 'Proj',
	/** Points so far this week. */
	pts: 'Pts',
	/** The Lineup's evidence columns (Lane 66e). */
	oppRank: 'Opp rank',
	avg: 'Avg',
	last: 'Last',
	delta: 'Δ Proj',
	/** The phone's evidence line names the opponent's rank shortly. */
	opp: 'Opp',
	/** The button that opens a swap's evidence line, as a screen reader hears it. */
	why: 'Why',
	/** The starters' sums row: "Team", never "Totals", a betting word on the site's list (Lane 66q). */
	totals: 'Team',
	bench: 'Bench',
	reserve: 'Injured reserve',
	bye: 'Bye',
	final: 'Final',
	/** A number not held yet: before kickoff, or with no projection. */
	none: '--',
	you: 'You',
	opponent: 'Opponent',
	noOpponent: 'No opponent this week',
	/** The kickoff weather's words where the venue says it all. */
	indoors: 'Indoors',
	roofOpen: 'Roof TBD',
	abroad: 'Abroad, no forecast',
	outdoors: 'Outdoors',
	/** The trade builder's tick, as a screen reader hears it, and its mark on the member's drop. */
	pick: 'Pick',
	drop: 'Drop'
} as const;

/** The trade builder's tick on a row (Lane 66g): picked or not, the member's drop (marked, not
 * tapped), or a player no trade takes (a defense, a kicker, injured reserve); the tap, and whether a
 * full side holds it back. */
export interface BoxPick {
	state: 'on' | 'off' | 'drop' | 'no';
	disabled: boolean;
	/** The tap; null where there is nothing to tap (the drop, a player no trade takes). */
	toggle: (() => void) | null;
}

/** A name's short form for a narrow cell (rereview N2): the first initial, then the last name whole,
 * "A. Rodgers"; a one-word name as it is. */
export function initialName(name: string): string {
	const first = name.trim().split(/\s+/)[0] ?? '';
	const last = lastName(name);
	return first === last ? name.trim() : `${first.charAt(0)}. ${last}`;
}

/** The slot's label in a box. */
export function slotWord(slot: BoxSlot): string {
	return SLOT_WORDS[slot];
}

/** A position as a box prints it: a defense is "D/ST". */
export function positionWord(position: string): string {
	return position === 'DEF' ? SLOT_WORDS.DEF : position;
}

/** The weather glyph a cell draws beside its words. */
export type WeatherGlyph = 'wind' | 'indoors' | 'roof' | 'abroad' | 'outdoors';

export interface WeatherCell {
	glyph: WeatherGlyph;
	words: string;
}

/** His game in the cell's first line: "at JAX" and "Sun 8:30 am", or "Final" once played. */
export interface BoxGame {
	where: string;
	when: string;
}

/** One row of a box. */
export interface BoxRow {
	key: string;
	/** His board id, for your sheet's tags on him; null for a player our board does not place. */
	boardId: string | null;
	/** You tag him Hold on a sheet (the API's held). */
	held: boolean;
	slot: string;
	name: string;
	/** His page on the site, null without one. */
	slug: string | null;
	face: { src: string | null; mark: boolean; alt: string };
	club: string;
	position: string;
	/** His position pill (Lane 63's StatusPill): his position on our order with his rank there, null
	 * for a defense, which the club mark names. */
	pill: { position: Position; rank: number | null } | null;
	/** His status as Lane 63's pill draws it: the week's designation, or a season-long list's word in
	 * place of his rank. */
	status: StatusView | null;
	/** His game, "bye" on a bye week, null when we hold none. */
	game: BoxGame | 'bye' | null;
	/** "20 to 22.5": the expected score with his club's first, null once kicked off or without it. */
	expected: string | null;
	weather: WeatherCell | null;
	/** This week's projection, null without one. */
	proj: number | null;
	/** His points so far, null until his game has kicked off. */
	pts: number | null;
	/** The season's figures the Lineup shows beside his projection (Lane 66e). */
	evidence: RowEvidence;
}

/** A Lineup row's evidence columns: his opponent's rank against his position (of how many ranked),
 * his points a game and his last game's, and his projection's change since the read before; the
 * Trades screen's last column, his rest-of-season points a game on our board (Lane 66g). */
export interface RowEvidence {
	oppRank: number | null;
	oppOf: number | null;
	avg: number | null;
	last: number | null;
	delta: number | null;
	season: number | null;
}

const NO_EVIDENCE: RowEvidence = {
	oppRank: null,
	oppOf: null,
	avg: null,
	last: null,
	delta: null,
	season: null
};

/** A box's totals row: the starters' projection and points so far summed, and how many playing
 * starters have a figure when one lacks it. */
export interface BoxTotals {
	proj: number | null;
	pts: number | null;
	/** Beside Totals: before the week's projection lands, that it has not; once it has, how many
	 * playing starters have a Proj when one lacks it. Null when there is nothing to say. */
	note: string | null;
}

/** A starter's place in a box: his row. */
export interface BoxStarter {
	row: BoxRow;
}

/** The season-long lists: their word stands in his rank ("RB IR"), as on the board. */
const SEASON_LONG = new Set<DesignationStatus>(['injured_reserve', 'pup', 'nfi']);

/** His status as Lane 63's pill draws it, the week's designation first, else the host's injured
 * reserve. A season-long list's chip is the board's (Lane 66n): "IR since Sep 28" from the API's
 * start of his run under it, or "IR" alone when the API knows none (the host's own mark). */
export function statusOf(
	designation: WeekFacts['designation'],
	hostIR: boolean,
	zone: string = memberZone()
): StatusView | null {
	const status: DesignationStatus | null =
		designation?.status ?? (hostIR ? 'injured_reserve' : null);
	if (status === null) return null;
	const seasonLong = SEASON_LONG.has(status);
	return {
		rank: seasonLong ? rankWord(status) : null,
		mark: seasonLong
			? seasonLongMark({ status, since: designation?.since ?? null }, zone)
			: designationWord(status),
		sits: sitsHim(status),
		line: null
	};
}

/** His position pill: the board's position (a defense has none, the club mark names it). */
function pillOf(position: string, rank: number | null): BoxRow['pill'] {
	const known = POSITIONS.find((p) => p === position);
	return known === undefined ? null : { position: known, rank };
}

/** "20 to 22.5": his club's expected points, then its opponent's, null without the figures. */
export function expectedWords(facts: Pick<WeekFacts, 'game_total'>): string | null {
	const total = facts.game_total;
	if (total === null) return null;
	return `${halves(total.team_points)} to ${halves(total.points - total.team_points)}`;
}

/** The kickoff weather in two or three words with its glyph: "63°, 13 mph", "Indoors", "Roof TBD",
 * "Abroad, no forecast", with the chance of rain or snow when it is worth naming; null when the venue
 * is not confirmed and no forecast is held. */
export function weatherCell(facts: Pick<WeekFacts, 'roof' | 'weather'>): WeatherCell | null {
	const { roof, weather } = facts;
	if (roof?.abroad) return { glyph: 'abroad', words: BOX.abroad };
	if (roof?.kind === 'dome') return { glyph: 'indoors', words: BOX.indoors };
	if (roof?.kind === 'retractable') return { glyph: 'roof', words: BOX.roofOpen };
	const parts: string[] = [];
	if (weather?.temperature_f != null) parts.push(`${String(Math.round(weather.temperature_f))}°`);
	if (weather?.wind_mph != null) parts.push(`${String(Math.round(weather.wind_mph))} mph`);
	const chance = weather?.precipitation_chance;
	if (chance != null && chance >= PRECIPITATION_NAMED_FROM) {
		const kind = weather?.precipitation_kind;
		const what = kind === 'snow' ? 'snow' : kind === 'ice' ? 'ice' : 'rain';
		parts.push(`${String(Math.round(chance))}% ${what}`);
	}
	if (parts.length > 0) return { glyph: 'wind', words: parts.join(', ') };
	return roof === null ? null : { glyph: 'outdoors', words: BOX.outdoors };
}

/** His game's first line: the opponent with "at" or "vs", then the kickoff on the member's clock, or
 * "Final" once played; "bye" on a bye week; null when we hold no game. */
export function gameOf(facts: WeekFacts, zone: string = memberZone()): BoxGame | 'bye' | null {
	if (facts.bye) return 'bye';
	if (facts.opponent === null) return null;
	const where = `${facts.home === false ? 'at' : 'vs'} ${facts.opponent}`;
	if (facts.played) return { where, when: BOX.final };
	return { where, when: facts.kickoff === null ? '' : weekdayTime(facts.kickoff, zone) };
}

/** A player's face: his headshot, or a defense's club mark with the club in its words. */
function faceOf(player: LeaguePlayer, headshot: string | null): BoxRow['face'] {
	if (player.position === 'DEF' && player.team !== '') {
		return { src: clubMark(player.team), mark: true, alt: defenseWords(player.team) };
	}
	return { src: headshot, mark: false, alt: '' };
}

/** A box row from the API's line for him. ranked draws his rest-of-season rank in his pill; the
 * Lineup leaves it out, since that screen gives the rank no basis (Lane 66e). */
export function boxRow(
	line: PlayerLine,
	slot: string,
	zone: string = memberZone(),
	ranked = true
): BoxRow {
	const { facts, player } = line;
	const ahead = !facts.bye && toBePlayed({ played: facts.played, kickoff: facts.kickoff });
	return {
		key: player.host_id,
		boardId: player.board_id,
		held: line.held,
		slot,
		name: player.name,
		slug: line.slug,
		face: faceOf(player, line.headshot),
		club: player.team,
		position: positionWord(player.position),
		pill: pillOf(player.position, ranked ? line.position_rank : null),
		status: statusOf(facts.designation, player.injured_reserve, zone),
		game: gameOf(facts, zone),
		expected: ahead ? expectedWords(facts) : null,
		weather: ahead ? weatherCell(facts) : null,
		proj: line.week_projection,
		pts: facts.points_this_week,
		evidence: evidenceOf(line)
	};
}

/** A row's evidence from his line. */
function evidenceOf(line: PlayerLine): RowEvidence {
	return {
		oppRank: line.opp_rank,
		oppOf: line.facts.allowed_to_position?.of ?? null,
		avg: line.season_avg,
		last: line.last_points,
		delta: line.projection_delta,
		season: line.rest_of_season_per_game
	};
}

/** How easy his opponent is at his position: the top third of points allowed is easy, the bottom
 * third hard. The rank prints with it, so the tint is never the only channel. */
export type Ease = 'easy' | 'hard' | 'even';

const EASE_THIRDS = 3;

/** How many clubs a rank is out of when the API does not say. */
export const RANKED_CLUBS = 32;

export function easeOf(rank: number, of: number | null): Ease {
	const ranked = of ?? RANKED_CLUBS;
	if (rank > (ranked * (EASE_THIRDS - 1)) / EASE_THIRDS) return 'easy';
	if (rank <= ranked / EASE_THIRDS) return 'hard';
	return 'even';
}

/** "24th", or "--" without a rank. */
export function oppRankWord(rank: number | null): string {
	return rank === null ? BOX.none : ordinal(rank);
}

/** A projection's change as its cell prints it: "+0.4", "−0.3", "0.0", "--" without one. */
export function deltaWord(delta: number | null): string {
	if (delta === null) return BOX.none;
	// The API's tenth (tenth.Round), formatted with its sign, never rounded here (Lane 66k H1).
	return delta === 0 ? fixed(0, 1) : signed(delta, 1);
}

/** A row for a host player the box has no line for (the league read alone, without our answer):
 * his name, club and position, and his points so far when the host gives them. */
export function hostRow(player: LeaguePlayer, slot: string, pts: number | null): BoxRow {
	return {
		key: player.host_id,
		boardId: player.board_id,
		held: false,
		slot,
		name: player.name,
		slug: null,
		face: faceOf(player, null),
		club: player.team,
		position: positionWord(player.position),
		pill: pillOf(player.position, null),
		status: statusOf(null, player.injured_reserve),
		game: null,
		expected: null,
		weather: null,
		proj: null,
		pts,
		evidence: NO_EVIDENCE
	};
}

/** The note beside Totals (review L2, N5): "No projection yet for week 6" before the week's
 * projection lands, "7 of 8 starters with a Proj" once it has when a playing starter lacks one,
 * else null. */
export function totalsNote(
	rows: readonly Pick<BoxRow, 'proj' | 'game'>[],
	landed: boolean,
	week: number
): string | null {
	if (!landed) return `No projection yet for week ${String(week)}`;
	const playing = rows.filter((r) => r.game !== 'bye');
	const held = playing.filter((r) => r.proj !== null).length;
	return held === playing.length
		? null
		: `${String(held)} of ${String(playing.length)} starters with a ${BOX.proj}`;
}

/** An API figure the API has already rounded to a tenth (Lane 66k: rounded once, in Go), printed as
 * given: formatting only, so the web never rounds it again. */
export function printTenth(value: number): string {
	const text = String(value);
	return text.includes('.') ? text : `${text}.0`;
}

/** The API's tenths summed, so Totals equal the column a reader adds up (review N2); null when none
 * is held. The sum is cleaned of binary noise back to the tenth it is, never rounded further. */
function printedSum(values: readonly (number | null)[]): number | null {
	const held = values.flatMap((v) => (v === null ? [] : [v]));
	if (held.length === 0) return null;
	return Math.round(held.reduce((a, b) => a + b, 0) * TENTHS) / TENTHS;
}

const TENTHS = 10;

/** The rows' projection as printed, summed; null when none of them has one. */
export function projTotal(rows: readonly Pick<BoxRow, 'proj'>[]): number | null {
	return printedSum(rows.map((r) => r.proj));
}

/** The rows' points so far as printed, summed; null before any of them has kicked off. */
export function ptsTotal(rows: readonly Pick<BoxRow, 'pts'>[]): number | null {
	return printedSum(rows.map((r) => r.pts));
}

/** Totals' Pts, one rule for both screens (review N1): where the host gives each player's points,
 * the rows' as printed; where it gives each team's total alone, that total, the rows staying "--". */
export function totalsPts(
	rows: readonly Pick<BoxRow, 'pts'>[],
	byPlayer: boolean,
	teamPoints: number | null
): number | null {
	return byPlayer ? ptsTotal(rows) : teamPoints;
}

/** How a box's numbers print: one decimal, "--" when not held. */
export function boxNumber(value: number | null): string {
	return value === null ? BOX.none : printTenth(value);
}

export const FORMAT_WORDS: Readonly<Record<ProjectionScoring['format'], string>> = {
	ppr: 'PPR',
	half_ppr: 'half-PPR',
	standard: 'standard'
};

/** The projection column's basis, said once on a screen (review H2): its scoring and whether that is
 * the league's own or the closest match, when it was read or that it is not in yet, and, when a
 * defense is on the screen, that defenses are on the published default scoring. */
export function projBasis(
	readAt: string | null,
	scoring: ProjectionScoring,
	defense: boolean,
	zone: string = memberZone()
): string {
	const whose = scoring.league_own
		? "this league's own"
		: "the closest match to this league's rules";
	const what = `${BOX.proj} is this week's published projection in ${FORMAT_WORDS[scoring.format]} scoring, ${whose}`;
	const when =
		readAt === null
			? 'not in yet for this week'
			: `read ${weekdayTime(readAt, zone)} ${zoneWord(zone)}`;
	const defenses = defense ? ' Defenses are on its default defense scoring.' : '';
	return `${what}, ${when}.${defenses} Our own weekly model replaces it when it passes its test.`;
}

/** The game facts' read, said once on a screen in place of a stamp on every row: the oldest read of
 * any game still to be played, null when no row holds one. */
export function factsReadLine(
	lines: readonly PlayerLine[],
	zone: string = memberZone()
): string | null {
	const oldest = factsReadAt(lines);
	if (oldest === null) return null;
	return `The ${BOX.game} cell shows each club's expected points, his club first, then the kickoff weather, read ${weekdayTime(oldest, zone)} ${zoneWord(zone)}.`;
}

/** The oldest read of any game still to be played, null when no row holds one: the Waivers basis
 * says it in its short line. */
export function factsReadAt(lines: readonly PlayerLine[]): string | null {
	const reads = lines.flatMap(({ facts }) =>
		facts.bye || !toBePlayed({ played: facts.played, kickoff: facts.kickoff })
			? []
			: [facts.game_total?.read_at, facts.weather?.read_at].filter(
					(at): at is string => at !== undefined
				)
	);
	if (reads.length === 0) return null;
	return reads.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
}

/** The projection's basis in one short line (the Waivers basis, review 66f M5): its scoring, whose,
 * its read, defenses' scoring when one is on the screen, and its change since the read before. */
export function projShort(
	readAt: string | null,
	previousReadAt: string | null,
	scoring: ProjectionScoring,
	defense: boolean,
	zone: string = memberZone(),
	league = true
): string {
	// With no league (a player page signed out) the scoring is named alone.
	const whose = !league
		? ''
		: scoring.league_own
			? ", this league's own"
			: ", the closest to this league's rules";
	const when =
		readAt === null ? 'not in yet' : `read ${weekdayTime(readAt, zone)} ${zoneWord(zone)}`;
	const defenses = defense ? ', defenses on its default scoring' : '';
	const delta =
		previousReadAt === null
			? ''
			: ` ${BOX.delta} is its change since ${weekdayTime(previousReadAt, zone)}.`;
	return `${BOX.proj} is this week's published projection in ${FORMAT_WORDS[scoring.format]} scoring${whose}, ${when}${defenses}.${delta}`;
}

/** The evidence columns in one short sentence pair (the Waivers basis). */
export const EVIDENCE_SHORT = `${BOX.oppRank} is points allowed to his position, 1st the fewest. ${BOX.avg} and ${BOX.last} are his points a game and last game, your scoring.`;

/** The game facts' read in one short sentence, null when no line holds one (the Waivers basis and
 * the player card's). */
export function factsReadShort(
	lines: readonly PlayerLine[],
	zone: string = memberZone()
): string | null {
	const read = factsReadAt(lines);
	return read === null
		? null
		: `The ${BOX.game} cell's expected points and weather were read ${weekdayTime(read, zone)} ${zoneWord(zone)}.`;
}

/** The Pts column's basis (review N1): a player's points as the league scores them where the
 * platform gives each player's, else the team's points alone, the platform named (Lane 66e). */
export function ptsBasis(byPlayer: boolean, host: LeagueHost): string {
	return byPlayer
		? `${BOX.pts} are this week's points as your league scores them, ${BOX.none} until his game kicks off.`
		: `${BOX.pts} are this league's team points from ${hostWords(host)}, which gives no points by player.`;
}

/** The Lineup's evidence columns' basis, said once (Lane 66e). */
export const EVIDENCE_BASIS = `${BOX.oppRank} is where his opponent stands in points allowed to his position this season, 1st allows the fewest. ${BOX.avg} and ${BOX.last} are his points a game this season and in his last game, in this league's scoring.`;

/** The change column's basis: since the snapshot before, its read named; null with none. */
export function deltaBasis(
	previousReadAt: string | null,
	zone: string = memberZone()
): string | null {
	if (previousReadAt === null) return null;
	return `${BOX.delta} is its change since the read before, ${weekdayTime(previousReadAt, zone)} ${zoneWord(zone)}.`;
}
