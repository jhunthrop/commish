/** The League page's in-season basis at a width (Lane 108, B82): the standings, a team's Proj and Pts,
 * and the Game cell, one paragraph. A desk says every sentence whole. A phone whose FFPC teams' words
 * run long (basis.ts unlistedLong) makes its cuts by the room left (Lane 141, B121): it makes none where
 * the paragraph fits its eight lines, and else the fewest that fit, in the order PHONE_CUTS makes them,
 * so the full Game sentence is the last thing cut and FFPC's tight end sentence the one before it.
 * Pure, tested in week-basis.test.ts. */
import type { LeagueSync } from '../api.ts';
import { gamePart, unlistedLong, unlistedPhoneForm, type UnlistedDrawn } from '../box/basis.ts';
import type { PlayerLine, Scoreboard } from '../inseason/api.ts';
import {
	bugsFinalNone,
	bugsMissListedFinal,
	bugsPlayingListed,
	NO_TEAM_CUTS,
	standingsBasis,
	teamBasis,
	unlistedDrawn,
	type Bug,
	type TeamCuts
} from './home.ts';

/** How the Game sentence is said: whole, or its read alone (basis.ts gamePart). */
export type GameSay = 'full' | 'read';

/** The phone's room for the paragraph: its eight lines (Lane 108) and the characters a line of the
 * basis's phone face (11 px at 390) is counted to hold. Measured on the FFPC stand-in's League page
 * (Lane 141): word-wrapped at 73 a line the count is never below the lines drawn over 151 lengths of
 * its words; 70 leaves room for a wider name, so a paragraph counted as fitting never draws a ninth. */
export const PHONE_ROOM = { lines: 8, chars: 70 } as const;

/** The lines a paragraph takes wrapped at `chars` characters a line, word by word. */
export function wrappedLines(text: string, chars: number): number {
	let lines = 0;
	let used = 0;
	for (const word of text.split(/\s+/).filter((w) => w !== '')) {
		if (lines === 0 || used + 1 + word.length > chars) {
			lines += 1;
			used = word.length;
		} else used += 1 + word.length;
	}
	return lines;
}

/** The paragraph's sentences, each said as its cuts say it. */
export interface WeekBasisParts {
	standings: string;
	/** A team's Proj and Pts (home.ts teamBasis), null with no scoreboard. */
	team: ((cuts: TeamCuts) => string) | null;
	/** The Game cell's sentence (basis.ts gamePart), null with no lineup read; a function giving null
	 * where no row draws the cell. */
	game: ((say: GameSay) => string | null) | null;
	/** What the sides the platform lists no starters for draw (home.ts unlistedDrawn). */
	unlisted: UnlistedDrawn;
}

/** What the League page's basis is said from: the league, its scoreboard and Lineup read, the bugs as
 * drawn at the page's clock. */
export interface LeagueWeekFacts {
	sync: Pick<LeagueSync, 'host' | 'terms'>;
	scoreboard: Pick<Scoreboard, 'projection_read_at' | 'projection_scoring'> | null;
	/** The Lineup read's rows carry each player's points (player_points). */
	playerPoints: boolean;
	/** The Lineup read's starters' lines for the Game cell, null with no read. */
	gameLines: readonly PlayerLine[] | null;
	bugs: readonly Bug[];
	now: number;
	zone: string;
}

/** The paragraph's sentences from the page's facts: the standings, a team's Proj and Pts, the Game
 * cell (its read time without the zone, which the season panel names once). */
export function leagueWeekParts(facts: LeagueWeekFacts): WeekBasisParts {
	const { sync, scoreboard, bugs, zone, now, gameLines } = facts;
	const unlisted = unlistedDrawn(bugs);
	return {
		standings: standingsBasis(sync.host, sync.terms),
		team:
			scoreboard === null
				? null
				: (cuts) =>
						teamBasis(
							sync.host,
							scoreboard.projection_read_at,
							scoreboard.projection_scoring,
							facts.playerPoints,
							zone,
							bugs.some((b) => b.state !== 'upcoming'),
							bugsMissListedFinal(bugs),
							bugsPlayingListed(bugs),
							bugsFinalNone(bugs),
							unlisted,
							cuts
						),
		game:
			gameLines === null ? null : (say) => gamePart(gameLines, { zone, zoned: false }, now, say),
		unlisted
	};
}

interface Cuts {
	team: TeamCuts;
	game: GameSay;
}

/** The Game sentence uncut: its read alone where the FFPC teams' words carry the pace clause (the Lineup
 * says what the cell is, Lane 127 fix round 3), at every width; else whole. */
function gameUncut(unlisted: UnlistedDrawn): GameSay {
	return unlisted.paced ? 'read' : 'full';
}

/** The phone's cuts, each the one before it and one more: the FFPC teams' words said short (or the two
 * sentences as one, unlistedPhoneForm), then "as of kickoff" left to the desk, then the tight end's
 * extra, last the Game sentence's read alone (Lane 137 fix round 1's cuts, now made by the room). */
function phoneCuts(unlisted: UnlistedDrawn): Cuts[] {
	const game = gameUncut(unlisted);
	const short: TeamCuts = { ...NO_TEAM_CUTS, unlistedForm: unlistedPhoneForm(unlisted) };
	const asOf: TeamCuts = { ...short, asOf: true };
	const bonus: TeamCuts = { ...asOf, teBonus: true };
	return [
		{ team: NO_TEAM_CUTS, game },
		{ team: short, game },
		{ team: asOf, game },
		{ team: bonus, game },
		{ team: bonus, game: 'read' }
	];
}

function paragraph(parts: WeekBasisParts, cuts: Cuts): string {
	return [parts.standings, parts.team?.(cuts.team) ?? null, parts.game?.(cuts.game) ?? null]
		.filter((sentence): sentence is string => sentence !== null && sentence !== '')
		.join(' ');
}

/** The paragraph a width says: a desk's whole; a phone's with the fewest cuts that fit its room. */
export function weekBasisText(
	parts: WeekBasisParts,
	width: 'desk' | 'phone',
	room: { lines: number; chars: number } = PHONE_ROOM
): string {
	const whole = paragraph(parts, { team: NO_TEAM_CUTS, game: gameUncut(parts.unlisted) });
	if (width === 'desk' || !unlistedLong(parts.unlisted)) return whole;
	const said = phoneCuts(parts.unlisted).map((cuts) => paragraph(parts, cuts));
	return said.find((text) => wrappedLines(text, room.chars) <= room.lines) ?? said.at(-1) ?? whole;
}
