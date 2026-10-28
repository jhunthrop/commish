/** The box score (Lane 66d): a team's players as columns, not sentences, for the Matchup and Lineup
 * screens. Each row is the slot, the player (his face, or a defense's club mark, his name, his status
 * in a word, his club and position), his game in one cell (the opponent and kickoff, then the
 * expected score with his club's first and the kickoff weather in two or three words), this week's
 * projection and his points so far. Pure functions over the API's player lines, so every word a box
 * prints is tested here. */
import { EMPTY_FIGURE } from '#lib/format/empty.ts';
import { FIGURE } from '#lib/format/figure-words.ts';
import { memberZone, weekdayTime } from '#lib/format/clock.ts';
import { defenseWords } from '#lib/format/clubs.ts';
import { isFreeAgent } from '#lib/format/free-agent.ts';
import { lastName } from '#lib/format/draft.ts';
import {
	designationWord,
	rankWord,
	calendarDay,
	returningMark,
	seasonLongMark,
	seasonLongStatus,
	sitsHim,
	type DesignationStatus
} from '#lib/format/designation.ts';
import type { StatusView } from '#lib/run/status-view.ts';
import { POSITIONS, type Position } from '#lib/types/player.ts';
import { GAME_STATE_WORDS, halves, PRECIPITATION_NAMED_FROM } from '#lib/format/game-facts.ts';
import { fixed, ordinal, signed } from '#lib/format/number.ts';
import { clubMark } from '#lib/ui/club-mark.ts';
import { lineState, stateWord, toPlay, type GameHead, type GameLine } from './kickoff.ts';
import { carriedMark } from './next-week.ts';
import type { LeaguePlayer } from '../api.ts';
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
	/** Once a game has kicked off, a team's Pts so far and the Proj of its starters still to play
	 * (Lane 92, the API's projected_final). */
	projFinal: 'Proj final',
	/** The Lineup's evidence columns (Lane 66e). */
	oppRank: 'Opp rank',
	/** Under the Opp rank head, its key (Lane 99, B56). */
	oppRankKey: '1st fewest allowed',
	/** The head over his position chip, our rest-of-season positional rank (Lane 99, B24). */
	ourRank: 'Our rank',
	avg: FIGURE.avg,
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
	/** A bench row on injured reserve, in place of his game: why he is a drop (Lane 98, B34). */
	irBench: 'IR-eligible, taking a bench spot',
	bye: 'Bye',
	/** A free agent's game cell (Lane 123, B101): his club cell is "FA", and he has no game to name. */
	noClub: 'No club',
	final: GAME_STATE_WORDS.final,
	/** The Lineup once every starter of the member's has played and the matchup still plays (Lane 91):
	 * nothing is left to set, and the week is not over. */
	locked: 'Locked',
	/** A game past its kickoff whose final is not in yet (Lane 80). */
	kickedOff: GAME_STATE_WORDS.kicked_off,
	/** A number not held yet: before kickoff, or with no projection. */
	none: EMPTY_FIGURE,
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

/** A row's name in the one line a phone gives it where the whole does not fit (Lane 115, B83): a
 * player's first initial and last name, a defense its club's nickname ("Vikings" from "Minnesota
 * Vikings", fix round 1, LOW-1), never an initial before a city. */
export function fitName(row: Pick<BoxRow, 'name' | 'face'>): string {
	return row.face.mark ? lastName(row.name.replace(/\s+D\/ST$/, '')) : initialName(row.name);
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
	 * for a defense, which the club mark names. ranked: the screen draws his rank (the Lineup and the
	 * Matchup), so a null rank is his, said as none (Lane 115, B93); false where the screen leaves
	 * every rank out (Waivers, Trades). */
	pill: { position: Position; rank: number | null; ranked: boolean } | null;
	/** His status as Lane 63's pill draws it: the week's designation, or a season-long list's word in
	 * place of his rank. */
	status: StatusView | null;
	/** He carries an injured reserve tag (the report's or the platform's own): a bench row says why
	 * he is a drop, an IR row draws no matchup (Lane 98, B34). */
	reserve: boolean;
	/** His game, "bye" on a bye week, "no-club" for a free agent, null when we hold none. */
	game: RowGame;
	/** "20 to 22.5": the expected score with his club's first, null once kicked off or without it. */
	expected: string | null;
	weather: WeatherCell | null;
	/** This week's projection, null without one. */
	proj: number | null;
	/** His points so far, null until his game has kicked off. */
	pts: number | null;
	/** His game is still to come at the page's clock (kickoff.ts toPlay): the Opp rank's colour draws
	 * only then (Lane 99, B56). */
	toCome: boolean;
	/** His game's state at the page's clock (kickoff.ts lineState): the player shelf's verb and its
	 * Proj or Pts tile follow it (Lane 113). Null on a bye or without a kickoff held. */
	state: GameHead['state'] | null;
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

/** The Team row's small figure under the Proj column (Lane 92, B22): none before the game kicks off,
 * where the Proj is the big figure; from kickoff the projected final; once every starter is final the
 * team's total, captioned Final (Lane 121, B99), the Pts it equals. */
export function teamSmallFigure(
	totals: Pick<BoxTotals, 'live' | 'allFinal' | 'final' | 'pts'>
): { caption: string; figure: number | null } | null {
	if (!totals.live) return null;
	return totals.allFinal
		? { caption: BOX.final, figure: totals.pts }
		: { caption: BOX.projFinal, figure: totals.final };
}

/** A box's totals row: the starters' projection and points so far summed, and how many playing
 * starters have a figure when one lacks it. */
export interface BoxTotals {
	proj: number | null;
	pts: number | null;
	/** The team's projected final once its game has kicked off (the API's projected_final, Lane 92),
	 * null when the API gives none (a starter still to play with no Proj, fix round 1). */
	final: number | null;
	/** The game has kicked off: Pts is the row's big figure and the projected final the small one;
	 * before it the Proj is the big one. */
	live: boolean;
	/** Every starter with a game is final at the page's clock (linesRead, Lane 121 B99): the small
	 * figure is the team's final total, captioned Final, no longer a projection. */
	allFinal: boolean;
	/** Beside Totals: before the week's projection lands, that it has not; once it has, how many
	 * playing starters have a Proj when one lacks it. Null when there is nothing to say. */
	note: string | null;
}

/** A starter's place in a box: his row. */
export interface BoxStarter {
	row: BoxRow;
}

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
	// The one season-long list (format/designation.ts), the API's flag for an out for the season.
	const seasonLong = seasonLongStatus(status, designation?.season_long === true);
	const returning = designation?.returning ?? null;
	return {
		rank: seasonLong ? rankWord(status) : null,
		// A listing carried over from a game already played says its date (Lane 95), never hidden; one
		// due back this week says his day (Lane 153).
		mark: seasonLong
			? seasonLongMark({ status, since: designation?.since ?? null, returning }, zone)
			: returning !== null
				? returningMark(returning)
				: (carriedMark(designation, zone) ?? designationWord(status)),
		// The tight row's chip (Lane 268): the box-score letters, his return day's weekday, or nothing
		// where the position pill already says the list ("RB IR").
		short: seasonLong
			? returning !== null
				? `Back ${calendarDay(returning)}`
				: null
			: returning !== null
				? returningShort(returning)
				: rankWord(status),
		sits: sitsHim(status),
		line: null,
		...(status === 'questionable' ? { question: true as const } : {})
	};
}

/** "Back Sun": a player due back this week in the few characters a tight row's chip has (the trade
 * rows, Lane 268); his day in full is the pill's word everywhere else. */
export function returningShort(returning: string): string {
	return `Back ${calendarDay(returning, true).slice(0, 3)}`;
}

/** Whether the API's designation has him due back this week (Lane 153): this week's question, so the
 * platform's own IR mark beside his name gives way to it. */
function dueBack(designation: WeekFacts['designation']): boolean {
	return (
		typeof designation?.returning === 'string' &&
		!seasonLongStatus(designation.status, designation.season_long === true)
	);
}

/** His status as a row draws it at the page's clock (Lane 104, B57): Questionable and Doubtful are
 * words about a game still to come, so once his game has kicked off they drop, and the platform's
 * injured reserve, if any, is what stays; Out and a season-long list stay whatever the clock. */
export function rowStatus(
	designation: WeekFacts['designation'],
	hostIR: boolean,
	toCome: boolean,
	zone: string = memberZone()
): StatusView | null {
	const status = statusOf(designation, hostIR, zone);
	if (status === null || status.sits || toCome) return status;
	return statusOf(null, hostIR && !dueBack(designation), zone);
}

/** A row as an injured reserve row draws it (Lane 98, B34): no game, expected score or weather and no
 * Opp rank (his matchup is not his), and in the IR slot no points and no Proj, a figure he will not
 * score (review L2); null keeps the row whole. */
export function reserveRow(row: BoxRow, reserve: 'bench' | 'slot' | null): BoxRow {
	if (reserve === null) return row;
	return {
		...row,
		game: null,
		expected: null,
		weather: null,
		pts: reserve === 'slot' ? null : row.pts,
		proj: reserve === 'slot' ? null : row.proj,
		// An IR slot row and a stash have no Proj this week, so no change in it either (Lane 118).
		evidence: {
			...row.evidence,
			oppRank: null,
			oppOf: null,
			delta: reserve === 'slot' ? null : row.evidence.delta
		}
	};
}

/** Whether he carries an injured reserve tag: the report lists him so, or the platform marks him and
 * the report does not have him due back this week (Lane 153). */
export function onReserve(line: Pick<PlayerLine, 'player' | 'facts'>): boolean {
	const { designation } = line.facts;
	return (
		(line.player.injured_reserve && !dueBack(designation)) ||
		designation?.status === 'injured_reserve'
	);
}

/** His rest-of-season rank as a row carries it: none while he is on a season-long list (Lane 128,
 * B106), since the in-season order never ranks a player on injured reserve as playing (the 2026-10-16
 * ruling); his status chip says the list, so the pill and the shelf show its word where the rank
 * would be. */
export function playingRank(rank: number | null, status: StatusView | null): number | null {
	return onList(status) ? null : rank;
}

/** His position pill: the board's position (a defense has none, the club mark names it). */
function pillOf(position: string, rank: number | null, ranked: boolean): BoxRow['pill'] {
	const known = POSITIONS.find((p) => p === position);
	return known === undefined ? null : { position: known, rank: ranked ? rank : null, ranked };
}

/** "20 to 22.5": his club's expected points, then its opponent's, null without the figures. */
export function expectedWords(facts: Pick<WeekFacts, 'game_total'>): string | null {
	const total = facts.game_total;
	if (total === null) return null;
	return `${halves(total.team_points)} to ${halves(total.points - total.team_points)}`;
}

/** The expected score's label (Lane 139, C07). */
const EXPECTED_SCORE = 'Expected score';

/** The expected score labelled, each club named (Lane 139, C07): "Expected score DET 28.5, GB 25", so
 * it never reads as a final; null without one or without an opponent to name. */
export function expectedScoreWords(
	facts: Pick<WeekFacts, 'game_total' | 'opponent'>,
	club: string
): string | null {
	const total = facts.game_total;
	if (total === null || facts.opponent === null) return null;
	const theirs = total.points - total.team_points;
	return `${EXPECTED_SCORE} ${club} ${halves(total.team_points)}, ${facts.opponent} ${halves(theirs)}`;
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

/** A box row's game: the game, the bye, a free agent's none ("No club", Lane 123), or null when we
 * hold no game. */
export type RowGame = BoxGame | 'bye' | 'no-club' | null;

/** The game a row's cell names, null on a bye, for a free agent and without one held. */
export function heldGame(game: RowGame): BoxGame | null {
	return game === null || game === 'bye' || game === 'no-club' ? null : game;
}

/** His game's first line: the opponent with "at" or "vs", then by the game's state at the page's clock
 * (kickoff.ts lineState, the one rule the score bug reads) the kickoff on the member's clock, "Kicked
 * off" or "Final"; "bye" on a bye week; "no-club" for a free agent, whose club cell is "FA" (he has no
 * game and no bye); null when we hold no game. */
export function gameOf(
	line: GameLine & { facts: WeekFacts },
	club: string,
	zone: string,
	now: number
): RowGame {
	const { facts } = line;
	if (isFreeAgent(club)) return 'no-club';
	if (facts.bye) return 'bye';
	if (facts.opponent === null) return null;
	const where = `${facts.home === false ? 'at' : 'vs'} ${facts.opponent}`;
	const state = lineState(line, now);
	if (state === 'final') return { where, when: stateWord(line.game_state, state, BOX.final) };
	if (state === 'kicked_off')
		return { where, when: stateWord(line.game_state, state, BOX.kickedOff) };
	return { where, when: facts.kickoff === null ? '' : weekdayTime(facts.kickoff, zone) };
}

/** A player's face: his headshot, or a defense's club mark with the club in its words. */
function faceOf(player: LeaguePlayer, headshot: string | null): BoxRow['face'] {
	if (player.position === 'DEF' && player.team !== '') {
		return { src: clubMark(player.team), mark: true, alt: defenseWords(player.team) };
	}
	return { src: headshot, mark: false, alt: '' };
}

/** A box row from the API's line for him. ranked draws his rest-of-season rank in his pill, under
 * the Our rank head with its sentence in the basis (Lane 99, B24); the Waivers and Trades rows leave
 * it out. */
export function boxRow(
	line: PlayerLine,
	slot: string,
	zone: string,
	ranked: boolean,
	now: number
): BoxRow {
	const { facts, player } = line;
	const ahead = toPlay(line, now);
	const status = rowStatus(facts.designation, player.injured_reserve, ahead, zone);
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
		pill: pillOf(player.position, playingRank(line.position_rank, status), ranked),
		status,
		reserve: onReserve(line),
		game: gameOf(line, player.team, zone, now),
		expected: ahead ? expectedWords(facts) : null,
		weather: ahead ? weatherCell(facts) : null,
		proj: onList(status) ? null : line.week_projection,
		pts: facts.points_this_week,
		toCome: ahead,
		state: lineState(line, now),
		evidence: evidenceOf(line, onList(status))
	};
}

/** He is on a season-long list (IR, PUP, NFI): his status carries the list's word. In season his
 * week is not his (Lane 128 fix round 1): no week Proj, no Opp rank and no change in either, on every
 * screen and on his card. */
export function onList(status: Pick<StatusView, 'rank'> | null): boolean {
	return (status?.rank ?? null) !== null;
}

/** A row's evidence from his line; a listed player's has no Opp rank and no change in his Proj. */
function evidenceOf(line: PlayerLine, listed: boolean): RowEvidence {
	return {
		oppRank: listed ? null : line.opp_rank,
		oppOf: listed ? null : (line.facts.allowed_to_position?.of ?? null),
		avg: line.season_avg,
		last: line.last_points,
		delta: listed ? null : line.projection_delta,
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
		pill: pillOf(player.position, null, false),
		status: statusOf(null, player.injured_reserve),
		reserve: player.injured_reserve,
		game: null,
		expected: null,
		weather: null,
		proj: null,
		pts,
		toCome: false,
		state: null,
		evidence: NO_EVIDENCE
	};
}

/** How many starters without a Proj the note names before it counts them. */
const NAMED_WITHOUT_PROJ = 2;

/** The note beside Totals (review L2, N5; Lane 99, B49): "No projection yet for week 6" before the
 * week's projection lands; once it has, the playing starters without a Proj by name, "DJ Moore had
 * no Proj" once their games have kicked off ("has" while one is still to come), "3 starters had no
 * Proj" past two; else null. */
export function totalsNote(
	rows: readonly Pick<BoxRow, 'proj' | 'game' | 'name' | 'toCome'>[],
	landed: boolean,
	week: number
): string | null {
	if (!landed) return `No projection yet for week ${String(week)}`;
	const lacking = rows.filter((r) => r.game !== 'bye' && r.proj === null);
	if (lacking.length === 0) return null;
	const verb = lacking.some((r) => r.toCome) ? 'has' : 'had';
	const who =
		lacking.length > NAMED_WITHOUT_PROJ
			? `${String(lacking.length)} starters`
			: lacking.map((r) => r.name).join(' and ');
	return `${who} ${verb} no ${BOX.proj}`;
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

/** The oldest read of any game still to be played at `now`, null when no row holds one: the Waivers
 * basis says it in its short line. */
export function factsReadAt(lines: readonly PlayerLine[], now: number): string | null {
	const reads = lines.flatMap((line) =>
		!toPlay(line, now)
			? []
			: [line.facts.game_total?.read_at, line.facts.weather?.read_at].filter(
					(at): at is string => at !== undefined
				)
	);
	if (reads.length === 0) return null;
	return reads.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
}
