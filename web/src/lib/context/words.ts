/** The site's context in words (founder ruling 2026-10-13: the league is the site's context): what
 * the shell's switch says, the one basis line a page prints about
 * the league, and the mark on a player another team holds. Pure, so the switch, the pages and the
 * tests read one spelling. */
import type { components } from '#lib/api/types.ts';
import { SCORING_WORDS, followedName } from '#lib/league/names.ts';
import { FORMAT_LABELS } from '#lib/sheet/format.ts';

type Schemas = components['schemas'];
export type ContextLeague = Schemas['ContextLeague'];
export type BoardFormat = Schemas['BoardFormat'];

/** The format every page opens in when the context names none: the run's default board. */
export const DEFAULT_CONTEXT_FORMAT: BoardFormat = 'ppr';

/** A followed league's name, or its host's when its read has none yet. */
export const leagueName = followedName;

/** The switch's own words: the selected league's name, else the format pages are in. */
export function switchLabel(league: ContextLeague | null, format: BoardFormat | null): string {
	return league ? leagueName(league) : FORMAT_LABELS[format ?? DEFAULT_CONTEXT_FORMAT];
}

/** The longest last word the switch keeps whole, its space included. */
const TAIL_MAX = 12;

/** The switch's label split for a cut in the middle: the last word, which tells one entry of a
 * contest from the next ("#104870"), always shows, and only the head gives way. */
export function labelEnds(label: string): [head: string, tail: string] {
	const cut = label.lastIndexOf(' ');
	return cut > 0 && label.length - cut <= TAIL_MAX
		? [label.slice(0, cut), label.slice(cut)]
		: [label, ''];
}

/** The scoring the figures are in, as a sentence names it: "PPR", "half PPR". */
function figuresWords(format: BoardFormat): string {
	const label = FORMAT_LABELS[format];
	return /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}

/** What a page's figures are, as its basis line opens: "This board is", "These figures are". */
export type FiguresSubject = 'This board is' | 'These figures are';

/** The league's scoring as a basis line opens, in plain words: TE premium is jargon a first-timer
 * cannot act on, so it says what it does. */
export function leagueScores(league: ContextLeague): string {
	return league.scoring === 'te_premium'
		? 'Your league gives tight ends extra points per catch.'
		: `Your league scores ${SCORING_WORDS[league.scoring]}.`;
}

/** Where a TE premium league's exact rules rank it, after "This board is plain PPR.": the Draft
 * Pass without custom_scoring, the league's own mock draft with it (its exact board), or nothing
 * when a mock room cannot draft the league. */
function exactWords(league: ContextLeague, exactRules: boolean): string {
	if (!exactRules) return " The Draft Pass ranks it by your league's exact rules.";
	return league.settings_league_id === null
		? ''
		: " Your league's exact board is in its mock draft.";
}

/** The page's one line about the league, null with no league selected. The figures' scoring names
 * its basis against the league's: the same, plain PPR beside a TE premium league with where its
 * exact rules rank it, a format this run does not carry, or (a link that named another board the
 * run carries) simply what this board is. exactRules is the account's custom_scoring. */
export function contextNote(
	league: ContextLeague | null,
	figures: BoardFormat,
	exactRules: boolean,
	subject: FiguresSubject = 'This board is',
	leagueBoardOnRun = false
): string | null {
	if (!league) return null;
	const scores = leagueScores(league);
	const figuresAre = `${subject} ${figuresWords(figures)}`;
	if (league.format !== figures) {
		if (leagueBoardOnRun) return `${scores} ${figuresAre}.`;
		const lower = figuresAre.charAt(0).toLowerCase() + figuresAre.slice(1);
		return `${scores} This run has no ${figuresWords(league.format)} board, so ${lower}.`;
	}
	if (league.scoring === 'te_premium') {
		return `${scores} ${subject} plain ${figuresWords(figures)}.${exactWords(league, exactRules)}`;
	}
	return league.format === 'superflex'
		? `Your league scores ${SCORING_WORDS[league.scoring]} and starts a superflex.`
		: scores;
}

/** The selected league's rosters as the pages mark them: who holds each player by our board id. */
export interface Held {
	/** The drafter's own roster. */
	me: number;
	/** Each team's name by its roster id. */
	teams: Readonly<Record<number, string>>;
	/** The roster holding each held player, by his board id. */
	by: Readonly<Record<string, number>>;
}

/** A row's league mark (HeldMark): the two that tell a reader something in October, when nearly every
 * top row is taken. */
export interface LeagueMark {
	/** Its accessible name: "On Grand Illusion BG 3", "Free agent in your league". */
	words: string;
	/** Yours (the accent, and the row takes your wash) or free to pick up. */
	kind: 'mine' | 'free';
}

const FREE_WORDS = 'Free agent in your league';

/** A row's mark, null with no rosters read or for a player another team holds: on your roster,
 * named by your team ("On Grand Illusion BG 3"), or a free agent. */
export function heldMark(held: Held | null, boardId: string): LeagueMark | null {
	if (held === null) return null;
	const roster = held.by[boardId];
	if (roster === undefined) return { words: FREE_WORDS, kind: 'free' };
	if (roster !== held.me) return null;
	const team = held.teams[roster] ?? '';
	return { words: team === '' ? 'On your roster' : `On ${team}`, kind: 'mine' };
}

/** Whose roster a player is on, as his page says it: "On your roster", "Rostered by Gmoneyman" ("On
 * a roster in your league" for a team with no name read), or a free agent. */
export function holderWords(held: Held, boardId: string): string {
	const roster = held.by[boardId];
	if (roster === undefined) return FREE_WORDS;
	if (roster === held.me) return 'On your roster';
	const team = held.teams[roster] ?? '';
	return team === '' ? 'On a roster in your league' : `Rostered by ${team}`;
}
