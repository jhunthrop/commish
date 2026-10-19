/** The in-season screens' basis parts (Lane 66t): what each column is, one short sentence each, so a
 * screen's basis names only the columns it draws, says each thing once, and fits five rendered lines
 * at a desk and eight on a phone. A screen joins the API's sentences (its rule, Gain, the figure a
 * game, the rules our stats lack) with these and hides the ones about columns its phone does not
 * draw (BasisPart.phone). Pure, tested in basis.test.ts. */
import { weekdayTime, zoneWord } from '#lib/format/clock.ts';
import { gameStateOf } from '#lib/format/game-facts.ts';
import type { BasisPart } from '#lib/run/board-basis.ts';
import type { LeagueHost } from '../api.ts';
import type { PlayerLine, ProjectionScoring } from '../inseason/api.ts';
import { hostWords } from '../names.ts';
import { BOX, FORMAT_WORDS, factsReadAt } from './box.ts';

export type { BasisPart };

/** The member's clock as a basis says its times: zoned names the zone after each, where the page says
 * it nowhere else (the in-season pages say it once in their head). */
export interface Clock {
	zone: string;
	zoned: boolean;
}

function stamp(at: string, clock: Clock): string {
	const time = weekdayTime(at, clock.zone);
	return clock.zoned ? `${time} ${zoneWord(clock.zone)}` : time;
}

export interface ProjFacts {
	readAt: string | null;
	scoring: ProjectionScoring;
	/** A defense is drawn on the screen, so its scoring is named. */
	defense: boolean;
	/** The rows are a league's, so the scoring is said against its rules. */
	league: boolean;
	/** The column's head: Proj on a box score, Wk 6 where the season's Projected sits beside it. */
	head?: string;
}

/** "Proj is this week's published projection, PPR nearest your rules, read Fri 9:00 pm." */
export function projPart(proj: ProjFacts, clock: Clock): string {
	const format = FORMAT_WORDS[proj.scoring.format];
	const whose = !proj.league
		? ` in ${format}`
		: proj.scoring.league_own
			? ' on your rules'
			: `, ${format} nearest your rules`;
	const defenses = proj.defense ? ', defenses on default scoring' : '';
	const when = proj.readAt === null ? 'not in yet' : `read ${stamp(proj.readAt, clock)}`;
	return `${proj.head ?? BOX.proj} is this week's published projection${whose}${defenses}, ${when}.`;
}

/** "Δ Proj is its change since Thu 9:00 pm.", null without a read before. */
export function deltaPart(previousReadAt: string | null, clock: Clock): string | null {
	return previousReadAt === null
		? null
		: `${BOX.delta} is its change since ${stamp(previousReadAt, clock)}.`;
}

/** The Game cell said whole where the screen draws the expected points and weather in it, its read
 * alone where the cell explains itself, or his next game's on the player card; null when no game still to be played holds a read. */
export function gamePart(
	lines: readonly PlayerLine[],
	clock: Clock,
	now: number,
	say: 'full' | 'read' | 'next'
): string | null {
	const read = factsReadAt(lines, now);
	if (read === null) return null;
	const at = stamp(read, clock);
	if (say === 'next') return `His next game's expected points and weather were read ${at}.`;
	return say === 'full'
		? `${BOX.game} is each club's expected points, his first, and weather, read ${at}.`
		: `${BOX.game} was read ${at}.`;
}

export const OPP_PART = `${BOX.oppRank} is points allowed to his position, 1st fewest.`;

/** When a game's final and its stats land (Lane 80), short enough for a phone's basis: the hourly
 * capture reads the game's status, so it turns Final within the hour after it ends; its stats, and so
 * Avg and Last, come with the weekly pass on Tuesday or by Wednesday evening (research JOBS.md). */
export const KICKED_OFF_PART = `${BOX.final} lands within the hour after a game, its stats by Wednesday.`;

/** KICKED_OFF_PART where a row's game has kicked off with no final yet, or is final with the week's
 * stats not in his games yet; else null. */
export function kickedOffPart(lines: readonly PlayerLine[]): string | null {
	const waiting = lines.some(({ facts }) => {
		if (facts.bye) return false;
		const state = gameStateOf(facts);
		return (
			state === 'kicked_off' ||
			(state === 'final' && !facts.last_games.some((game) => game.week === facts.week))
		);
	});
	return waiting ? KICKED_OFF_PART : null;
}

/** Avg and Last where a page says what they are (the player card): in the scoring the rows are in. */
export function avgLastPart(scoring: string): string {
	return `${BOX.avg} and ${BOX.last} are his points a game and last game, ${scoring}.`;
}

/** What a screen's Team row prints: the rows it shows added, or the platform's own total (the Matchup
 * on a platform that sends one, ruling (a) of Lane 79). */
export type TeamFigure = 'rows' | 'platform';

/** The Pts column and the Team row in one sentence, by the API's per-platform rule (player_points,
 * team_total, Lane 79): the platform's points by player so far and what Team is, else its team points
 * with none by player (Team is then that total). */
export function ptsPart(byPlayer: boolean, host: LeagueHost, team: TeamFigure): string {
	const platform = hostWords(host);
	if (!byPlayer) return `${BOX.pts} are ${platform}'s team points, none by player.`;
	return team === 'platform'
		? `${BOX.pts} are ${platform}'s points by player so far, each to a tenth, and Team is ${platform}'s score.`
		: `${BOX.pts} are ${platform}'s points by player so far, and Team adds the rows.`;
}

/** The API's count of the rules our stats lack, then its link to the league's Settings, which lists
 * them; none when it counts none. */
export function uncountedParts(
	advice: { basis_note: string; basis_note_link: string },
	href: string
): BasisPart[] {
	if (advice.basis_note === '') return [];
	return [
		{ text: advice.basis_note, phone: true },
		{ text: advice.basis_note_link, phone: true, href }
	];
}

/** A sentence part for a basis, none for an empty one. */
export function said(text: string | null, phone = true): BasisPart[] {
	return text === null || text === '' ? [] : [{ text, phone }];
}

/** The block as one paragraph reads, every part drawn: a link that more words follow closes its
 * sentence (BasisBlock draws the same). */
export function basisText(parts: readonly BasisPart[]): string {
	return parts.map((p, i) => (p.href && i < parts.length - 1 ? `${p.text}.` : p.text)).join(' ');
}

/** What a box score screen's key is told (BoxBasis): the projection, the lines drawn, the Pts
 * column's source, and on the Lineup its evidence columns' change and uncounted rules. */
export interface BoxBasisFacts {
	projection: { readAt: string | null; scoring: ProjectionScoring } | null;
	lines: readonly PlayerLine[];
	byPlayer: boolean;
	/** The platform sends the side's own total, which the Matchup's Team row prints (team_total). */
	teamTotal: boolean;
	host: LeagueHost;
	/** The Lineup's: the read the change counts from, the API's count of the rules our stats lack,
	 * and its link; null on the Matchup, which draws no evidence columns. */
	lineup: {
		previousReadAt: string | null;
		note: { basis_note: string; basis_note_link: string };
		rulesHref: string;
	} | null;
}

/** A box score screen's key under its rows, one paragraph (Lane 66t): Proj, on the Lineup its change
 * (a desk column), the Game cell, Opp rank, Pts and the rules Avg and Last leave out; on the Matchup
 * Proj, Pts and the Game cell, the columns it draws. */
export function boxBasisParts(facts: BoxBasisFacts, clock: Clock, now: number): BasisPart[] {
	const defense = facts.lines.some((l) => l.player.position === 'DEF');
	const proj = facts.projection
		? said(projPart({ ...facts.projection, defense, league: true }, clock))
		: [];
	const { lineup } = facts;
	// The Lineup's Team adds the lineup's rows; the Matchup's is the platform's total where it sends one.
	const team = lineup === null && facts.teamTotal ? 'platform' : 'rows';
	const pts = said(ptsPart(facts.byPlayer, facts.host, team));
	const game = said(gamePart(facts.lines, clock, now, 'full'));
	if (lineup === null) return [...proj, ...pts, ...game];
	return [
		...proj,
		...said(deltaPart(lineup.previousReadAt, clock), false),
		...game,
		...said(OPP_PART),
		...pts,
		...uncountedParts(lineup.note, lineup.rulesHref)
	];
}
