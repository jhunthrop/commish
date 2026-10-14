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

/** The page's one line about the league, null with no league selected. The figures' scoring names
 * its basis against the league's: the same, the nearest preset until exact rules arrive with the
 * Draft Pass (TE premium), a format this run does not carry, or (a link that named another board
 * the run carries) simply what this board is. */
export function contextNote(
	league: ContextLeague | null,
	figures: BoardFormat,
	subject: FiguresSubject = 'This board is',
	leagueBoardOnRun = false
): string | null {
	if (!league) return null;
	const scoring = SCORING_WORDS[league.scoring];
	const scores = `Your league scores ${scoring}.`;
	const figuresAre = `${subject} ${figuresWords(figures)}`;
	if (league.format !== figures) {
		if (leagueBoardOnRun) return `${scores} ${figuresAre}.`;
		const lower = figuresAre.charAt(0).toLowerCase() + figuresAre.slice(1);
		return `${scores} This run has no ${figuresWords(league.format)} board, so ${lower}.`;
	}
	if (league.scoring === 'te_premium') {
		return `${scores} ${figuresAre} until exact rules arrive with the Draft Pass.`;
	}
	return league.format === 'superflex'
		? `Your league scores ${scoring} and starts a superflex.`
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

/** A player's held mark (HeldMark), null when no team in the league holds him: whose words ("On your
 * roster", "Rostered by Gmoneyman", or "On a roster in your league" for a team with no name read),
 * and whether he is on your roster. */
export function heldMark(
	held: Held | null,
	boardId: string
): { words: string; mine: boolean } | null {
	const roster = held?.by[boardId];
	if (held === null || roster === undefined) return null;
	if (roster === held.me) return { words: 'On your roster', mine: true };
	const team = held.teams[roster] ?? '';
	return { words: team === '' ? 'On a roster in your league' : `Rostered by ${team}`, mine: false };
}
